/** HTTP statuses that mean the RPC rejects the client, not the request. */
const AUTH_FAILURE_HTTP_STATUSES = [401, 403];

/** Maximum length of an error message in a log line. */
const MAX_LOGGED_ERROR_MESSAGE_LENGTH = 300;

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  response?: { statusCode?: unknown } | null;
  status?: unknown;
};

/**
 * Returns the HTTP status of an ethers error (`response.statusCode`),
 * or of an RpcFailure that kept it (`status`).
 */
export function getHttpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const error = err as ErrorLike;
  const status = error.response?.statusCode ?? error.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Returns true if the error is an ethers SERVER_ERROR with an HTTP 401 or 403 response.
 */
export function isAuthFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const error = err as ErrorLike;
  if (error.code !== 'SERVER_ERROR') {
    return false;
  }
  const status = getHttpStatus(error);
  return status !== undefined && AUTH_FAILURE_HTTP_STATUSES.includes(status);
}

function truncate(text: string): string {
  if (text.length <= MAX_LOGGED_ERROR_MESSAGE_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_LOGGED_ERROR_MESSAGE_LENGTH)}... [truncated]`;
}

/**
 * Returns a short summary of an RPC error for logs.
 * Ethers errors contain the full response body, so the error object must not be logged as is.
 */
export function summarizeRpcError(error: unknown): Record<string, unknown> {
  try {
    if (typeof error !== 'object' || error === null) {
      return { message: truncate(String(error)) };
    }
    const errorLike = error as ErrorLike;
    const summary: Record<string, unknown> = {};
    if (typeof errorLike.name === 'string') {
      summary.name = errorLike.name;
    }
    if (errorLike.code !== undefined) {
      summary.code = errorLike.code;
    }
    const message =
      typeof errorLike.shortMessage === 'string'
        ? errorLike.shortMessage
        : typeof errorLike.message === 'string'
          ? errorLike.message
          : String(error);
    summary.message = truncate(message);
    const status = getHttpStatus(errorLike);
    if (status !== undefined) {
      summary.status = status;
    }
    return summary;
  } catch {
    return { message: 'Unserializable error' };
  }
}
