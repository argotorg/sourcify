/**
 * Minimal client for the Sourcify API v2 verification flow.
 *
 * v2 is asynchronous: POSTing a verification returns a `verificationId`
 * immediately and the result has to be polled from the job endpoint. This
 * module hides that two-step dance behind `verifyFromMetadata`.
 */

export class AlreadyVerifiedError extends Error {
  constructor(message) {
    super(message);
    this.name = "AlreadyVerifiedError";
  }
}

export class VerificationJobError extends Error {
  constructor(message, customCode) {
    super(message);
    this.name = "VerificationJobError";
    this.customCode = customCode;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeServerUrl = (server) => server.replace(/\/+$/, "");

const readErrorBody = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

/**
 * Submits a metadata + sources verification and returns the job's
 * `verificationId`.
 *
 * Throws AlreadyVerifiedError when the contract is already verified with both
 * an exact runtime and an exact creation match, which the server reports as a
 * 409 `already_verified`. Callers generally want to treat that as success.
 */
export async function submitMetadataVerification({
  server,
  chainId,
  address,
  metadata,
  sources,
  creationTransactionHash,
  headers = {},
}) {
  const url = `${normalizeServerUrl(server)}/v2/verify/metadata/${chainId}/${address}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ metadata, sources, creationTransactionHash }),
  });

  if (response.status === 202) {
    const { verificationId } = await response.json();
    return verificationId;
  }

  const body = await readErrorBody(response);
  if (response.status === 409 && body.customCode === "already_verified") {
    throw new AlreadyVerifiedError(
      body.message || `${chainId} ${address} is already verified`,
    );
  }

  throw new Error(
    `Verification request failed with status ${response.status}: ${
      body.message || JSON.stringify(body)
    }`,
  );
}

/**
 * Polls a verification job until it completes.
 *
 * Resolves with the finished job, or throws VerificationJobError if the job
 * completed with a verification error.
 */
export async function waitForVerificationJob({
  server,
  verificationId,
  pollIntervalMs = 1000,
  timeoutMs = 15 * 60 * 1000,
}) {
  const url = `${normalizeServerUrl(server)}/v2/verify/${verificationId}`;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const response = await fetch(url);
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new Error(
        `Failed to fetch job ${verificationId} with status ${response.status}: ${
          body.message || JSON.stringify(body)
        }`,
      );
    }

    const job = await response.json();
    if (job.isJobCompleted) {
      if (job.error) {
        throw new VerificationJobError(
          job.error.message || "Verification failed",
          job.error.customCode,
        );
      }
      return job;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs} ms waiting for job ${verificationId}`,
      );
    }

    await sleep(pollIntervalMs);
  }
}

/**
 * Submits a verification and waits for it to finish.
 *
 * Returns the completed job, or `null` when the contract was already verified.
 */
export async function verifyFromMetadata({
  server,
  chainId,
  address,
  metadata,
  sources,
  creationTransactionHash,
  headers,
  pollIntervalMs,
  timeoutMs,
}) {
  let verificationId;
  try {
    verificationId = await submitMetadataVerification({
      server,
      chainId,
      address,
      metadata,
      sources,
      creationTransactionHash,
      headers,
    });
  } catch (err) {
    if (err instanceof AlreadyVerifiedError) {
      return null;
    }
    throw err;
  }

  return waitForVerificationJob({
    server,
    verificationId,
    pollIntervalMs,
    timeoutMs,
  });
}

/**
 * Splits a RepositoryV1 contract folder (a map of relative path -> content)
 * into the `metadata` object and the `sources` map the v2 API expects.
 *
 * Sources are stored under `sources/` in RepositoryV1; the prefix is stripped
 * so the paths line up with the ones in metadata. Matching is done by content
 * hash regardless, so this is cosmetic, but it keeps job output readable.
 */
export function splitRepositoryFiles(files) {
  let metadata;
  const sources = {};

  for (const [filePath, content] of Object.entries(files)) {
    const normalized = filePath.replace(/^\.?\//, "");
    if (normalized === "metadata.json") {
      metadata = JSON.parse(content);
    } else {
      sources[normalized.replace(/^sources\//, "")] = content;
    }
  }

  if (!metadata) {
    throw new Error("No metadata.json found in the contract folder");
  }

  return { metadata, sources };
}
