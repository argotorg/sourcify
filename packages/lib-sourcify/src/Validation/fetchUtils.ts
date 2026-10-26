import { logError, logInfo, logDebug } from '../logger';
import { id as keccak256str } from 'ethers';

// Hosts a missing source may be fetched from by file name. The operator-configured
// IPFS gateway is the only other destination (see performFetch's `trusted`).
export const ALLOWED_SOURCE_HOSTS = ['raw.githubusercontent.com'];

const DEFAULT_BACKOFF = 10000;
const DEFAULT_RETRIES = 4;
const DEFAULT_BODY_TIMEOUT = 60_000;
const DEFAULT_MAX_BODY_BYTES = 10_000_000;

export interface FetchOptions {
  /** Skip the host allowlist and follow redirects. Only for the operator-configured IPFS gateway. */
  trusted?: boolean;
  /** Max ms to read the body after the headers arrived */
  bodyTimeout?: number;
  /** Max body size in bytes */
  maxBodyBytes?: number;
}

// Maps a source file name to the URL it may be fetched from, or null.
// github.com/<owner>/<repo>/blob/<ref>/<path> is rewritten to raw.githubusercontent.com;
// URLs on an allowlisted host are taken as they are.
export function getFetchableSourceUrl(fileName: string): string | null {
  let url: URL;
  try {
    url = new URL(fileName);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'github.com' || host === 'www.github.com') {
    const match = url.pathname.match(
      /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/blob\/(.+)$/,
    );
    if (!match) return null;
    return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
  }
  if (ALLOWED_SOURCE_HOSTS.includes(host)) {
    return `https://${host}${url.pathname}`;
  }
  return null;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function readBody(
  res: Response,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => undefined);
  }, timeoutMs);
  timer.unref();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) throw new Error(`Body not read within ${timeoutMs} ms`);
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Body larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function performFetch(
  url: string,
  hash?: string,
  fileName?: string,
  headers: HeadersInit = {},
  options: FetchOptions = {},
): Promise<string | null> {
  const host = hostnameOf(url);
  if (!options.trusted && (!host || !ALLOWED_SOURCE_HOSTS.includes(host))) {
    logError('Refusing to fetch from a host that is not allowlisted', {
      url,
      fileName,
    });
    return null;
  }

  logInfo('Fetching file', {
    url,
    hash,
    fileName,
  });
  const res = await fetchWithBackoff(
    url,
    headers,
    DEFAULT_BACKOFF,
    DEFAULT_RETRIES,
    {
      // A redirect off an allowlisted host would bypass the allowlist
      redirect: options.trusted ? 'follow' : 'error',
    },
  ).catch((err) => {
    logError(err);
  });

  if (res) {
    if (res.status === 200) {
      let content: string;
      try {
        content = await readBody(
          res,
          options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
          options.bodyTimeout ?? DEFAULT_BODY_TIMEOUT,
        );
      } catch (error) {
        logError('Failed to read the fetched file', {
          url,
          hash,
          fileName,
          error,
        });
        return null;
      }
      if (hash && keccak256str(content) !== hash) {
        logError("The calculated and the provided hash don't match.");
        return null;
      }

      logInfo('Fetched the file', {
        fileName,
        url,
        hash,
      });
      return content;
    } else {
      logError('Failed to fetch the file', {
        url,
        hash,
        fileName,
        status: res.status,
      });
      return null;
    }
  }
  return null;
}

/**
 * Fetches a resource with an exponential timeout.
 * 1) Send req, wait backoff * 2^0 ms, abort if doesn't resolve
 * 2) Send req, wait backoff * 2^1 ms, abort if doesn't resolve
 * 3) Send req, wait backoff * 2^2 ms, abort if doesn't resolve...
 * ...
 * ...
 */
export async function fetchWithBackoff(
  resource: string,
  headers: HeadersInit = {},
  backoff: number = DEFAULT_BACKOFF,
  retries: number = DEFAULT_RETRIES,
  init: Pick<RequestInit, 'redirect'> = {},
) {
  let timeout = backoff;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      logDebug('Start fetchWithBackoff', {
        resource,
        headers,
        timeout,
        attempt,
      });
      const controller = new AbortController();
      const id = setTimeout(() => {
        logDebug('Aborting request', { resource, headers, timeout, attempt });
        controller.abort();
      }, timeout);
      const response = await fetch(resource, {
        signal: controller.signal,
        headers,
        ...init,
      });
      logDebug('Success fetchWithBackoff', { resource, timeout, attempt });
      clearTimeout(id);
      return response;
    } catch (error) {
      if (attempt === retries) {
        logError('Failed fetchWithBackoff', {
          resource,
          headers,
          attempt,
          retries,
          timeout,
          error,
        });
        throw new Error(`Failed fetching ${resource}: ${error}`);
      } else {
        timeout *= 2; // exponential backoff
        logDebug('Retrying fetchWithBackoff', {
          resource,
          headers,
          attempt,
          timeout,
          error,
        });
        continue;
      }
    }
  }
  throw new Error(`Failed fetching ${resource}`);
}
