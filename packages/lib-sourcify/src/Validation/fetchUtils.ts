import { logError, logInfo, logDebug, logWarn } from '../logger';
import { id as keccak256str } from 'ethers';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

export interface FetchOptions {
  /**
   * Allow fetching from hosts that resolve to private, loopback, link-local
   * or otherwise non-public addresses. Only set this for operator-configured
   * destinations (e.g. a self-hosted IPFS gateway). Never set it for URLs
   * derived from user input.
   */
  allowPrivateHosts?: boolean;
  /**
   * Maximum number of redirects to follow. Every hop is validated again.
   */
  maxRedirects?: number;
  /**
   * Upper bound in milliseconds for reading the whole response body after the
   * headers arrived. Protects against servers that keep a connection open by
   * sending a byte every now and then.
   */
  bodyTimeout?: number;
}

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_BODY_TIMEOUT = 60_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function performFetch(
  url: string,
  hash?: string,
  fileName?: string,
  headers: HeadersInit = {},
  options: FetchOptions = {},
): Promise<string | null> {
  logInfo('Fetching file', {
    url,
    hash,
    fileName,
  });
  const res = await fetchWithBackoff(
    url,
    headers,
    undefined,
    undefined,
    options,
  ).catch((err) => {
    logError(err);
  });

  if (res) {
    if (res.status === 200) {
      let content: string;
      try {
        content = await res.text();
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

function parseIPv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return null;
  }
  return octets;
}

function isPublicIPv4(address: string): boolean {
  const o = parseIPv4(address);
  if (!o) return false;
  const [a, b] = o;
  if (a === 0) return false; // 0.0.0.0/8 "this" network
  if (a === 10) return false; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGNAT
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 private
  if (a === 192 && b === 0 && o[2] === 0) return false; // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && o[2] === 2) return false; // TEST-NET-1
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && o[2] === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && o[2] === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast and reserved
  return true;
}

function isPublicIPv6(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0];
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible addresses
  const mapped = lower.match(/^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]);
  const mappedHex = lower.match(
    /^(?:0*:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPublicIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  if (lower === '::' || lower === '::1') return false; // unspecified, loopback
  if (/^(0*:)+0*1?$/.test(lower)) return false;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return false; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return false; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(lower)) return false; // multicast
  if (/^64:ff9b:/.test(lower)) return false; // NAT64, may map to private v4
  if (/^2001:db8:/.test(lower)) return false; // documentation
  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIPv4(address);
  if (version === 6) return isPublicIPv6(address);
  return false;
}

/**
 * DNS resolution used by assertPublicUrl. Kept on an object so tests can
 * replace it without touching the real resolver.
 */
export const dnsResolver = {
  lookup: (hostname: string) => lookup(hostname, { all: true, verbatim: true }),
};

/**
 * Throws if the URL does not point to a public host. Only http(s) is accepted.
 * Hostnames are resolved and every resolved address has to be public, so that
 * a name pointing at both a public and a private address is rejected.
 */
export async function assertPublicUrl(resource: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    throw new Error(`Refusing to fetch invalid URL: ${resource}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Refusing to fetch ${resource}: unsupported protocol ${url.protocol}`,
    );
  }
  if (url.username || url.password) {
    throw new Error(`Refusing to fetch ${resource}: credentials in URL`);
  }
  // URL.hostname keeps the brackets for IPv6 literals
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error(`Refusing to fetch ${resource}: non-public host`);
  }

  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const results = await dnsResolver.lookup(hostname);
      addresses = results.map((r) => r.address);
    } catch {
      throw new Error(`Refusing to fetch ${resource}: cannot resolve host`);
    }
  }
  if (addresses.length === 0 || !addresses.every(isPublicIpAddress)) {
    throw new Error(`Refusing to fetch ${resource}: non-public host`);
  }
  return url;
}

class NonRetriableFetchError extends Error {}

/**
 * Fetches a resource with an exponential timeout.
 * 1) Send req, wait backoff * 2^0 ms, abort if doesn't resolve
 * 2) Send req, wait backoff * 2^1 ms, abort if doesn't resolve
 * 3) Send req, wait backoff * 2^2 ms, abort if doesn't resolve...
 * ...
 * ...
 *
 * Unless `options.allowPrivateHosts` is set, the resource and every redirect
 * target must resolve to a public address. Redirects are followed manually so
 * each hop is checked. The returned response's body read is bounded by
 * `options.bodyTimeout`.
 */
export async function fetchWithBackoff(
  resource: string,
  headers: HeadersInit = {},
  backoff: number = 10000,
  retries: number = 4,
  options: FetchOptions = {},
) {
  let timeout = backoff;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const bodyTimeout = options.bodyTimeout ?? DEFAULT_BODY_TIMEOUT;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      logDebug('Start fetchWithBackoff', {
        resource,
        headers,
        timeout,
        attempt,
      });
      timer = setTimeout(() => {
        logDebug('Aborting request', { resource, headers, timeout, attempt });
        controller.abort();
      }, timeout);

      let current = resource;
      let response: Response | undefined;
      for (let hop = 0; hop <= maxRedirects; hop++) {
        if (!options.allowPrivateHosts) {
          try {
            await assertPublicUrl(current);
          } catch (error) {
            throw new NonRetriableFetchError((error as Error).message);
          }
        }
        response = await fetch(current, {
          signal: controller.signal,
          headers,
          redirect: 'manual',
        });
        if (!REDIRECT_STATUSES.has(response.status)) {
          break;
        }
        const location = response.headers.get('location');
        if (!location) {
          break;
        }
        let next: string;
        try {
          next = new URL(location, current).toString();
        } catch {
          throw new NonRetriableFetchError(
            `Refusing to follow invalid redirect from ${current}`,
          );
        }
        logDebug('Following redirect', { from: current, to: next, hop });
        if (hop === maxRedirects) {
          throw new NonRetriableFetchError(
            `Too many redirects fetching ${resource}`,
          );
        }
        // Drain the redirect response so the connection can be reused
        await response.text().catch(() => undefined);
        current = next;
      }
      if (!response) {
        throw new Error('No response');
      }
      logDebug('Success fetchWithBackoff', { resource, timeout, attempt });
      clearTimeout(timer);
      // Keep a deadline on the body read. Aborting an already consumed
      // response is a no-op, and unref keeps the timer from holding the
      // process open.
      const bodyTimer = setTimeout(() => {
        logWarn('Aborting slow response body', { resource, bodyTimeout });
        controller.abort();
      }, bodyTimeout);
      bodyTimer.unref();
      return response;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof NonRetriableFetchError) {
        logWarn('Refused fetchWithBackoff', { resource, error: error.message });
        throw new Error(`Failed fetching ${resource}: ${error.message}`);
      }
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
