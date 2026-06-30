/**
 * Error thrown when the Sourcify HTTP API responds with a non-2xx status.
 *
 * `code` is the API's `customCode` when present (e.g. `unsupported_chain`),
 * otherwise a normalized fallback (`not_found` for 404, `api_error` otherwise),
 * so callers can distinguish "chain not supported" from "contract not found".
 */
export class SourcifyApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SourcifyApiError";
  }
}
