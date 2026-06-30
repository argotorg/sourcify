import { SourcifyApiError } from "./errors";

/** Verification match status as returned by the Sourcify v2 API. */
export type MatchStatus = "exact_match" | "match" | null;

/** A (partial) verified-contract record from `GET /v2/contract/{chainId}/{address}`. */
export interface ContractData {
  chainId?: string;
  address?: string;
  match?: MatchStatus;
  creationMatch?: MatchStatus;
  runtimeMatch?: MatchStatus;
  verifiedAt?: string;
  matchId?: string;
  abi?: unknown;
  metadata?: unknown;
  sources?: Record<string, unknown>;
  compilation?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A single entry from `GET /v2/contracts/{chainId}`. */
export interface ContractListItem {
  address: string;
  match?: MatchStatus;
  matchId?: string;
  verifiedAt?: string;
  [key: string]: unknown;
}

export interface ContractListResult {
  results: ContractListItem[];
  [key: string]: unknown;
}

/** A single entry from `GET /chains`. */
export interface ChainInfo {
  chainId: number;
  name: string;
  supported: boolean;
  [key: string]: unknown;
}

export interface GetContractOptions {
  fields?: string[];
  omit?: string[];
}

export interface ListContractsOptions {
  limit?: number;
  sort?: "asc" | "desc";
  afterMatchId?: string;
}

/**
 * Thin HTTP client for the public Sourcify v2 API.
 *
 * Performs no business logic beyond building request URLs and normalizing
 * error responses into {@link SourcifyApiError}. All verification logic lives
 * in the Sourcify server; this only consumes its public endpoints.
 */
export class SourcifyClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async getContract(
    chainId: number,
    address: string,
    opts: GetContractOptions = {},
  ): Promise<ContractData> {
    if (opts.fields && opts.omit) {
      throw new Error(
        "`fields` and `omit` are mutually exclusive; provide only one",
      );
    }
    const url = new URL(`${this.baseUrl}/v2/contract/${chainId}/${address}`);
    if (opts.fields) url.searchParams.set("fields", opts.fields.join(","));
    if (opts.omit) url.searchParams.set("omit", opts.omit.join(","));
    return this.request<ContractData>(url);
  }

  async listContracts(
    chainId: number,
    opts: ListContractsOptions = {},
  ): Promise<ContractListResult> {
    const url = new URL(`${this.baseUrl}/v2/contracts/${chainId}`);
    if (opts.limit !== undefined)
      url.searchParams.set("limit", String(opts.limit));
    if (opts.sort) url.searchParams.set("sort", opts.sort);
    if (opts.afterMatchId)
      url.searchParams.set("afterMatchId", opts.afterMatchId);
    return this.request<ContractListResult>(url);
  }

  async getChains(): Promise<ChainInfo[]> {
    return this.request<ChainInfo[]>(new URL(`${this.baseUrl}/chains`));
  }

  private async request<T>(url: URL): Promise<T> {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    const body = await res.json().catch(() => undefined);

    if (!res.ok) {
      const record = (body ?? {}) as Record<string, unknown>;
      const code =
        typeof record.customCode === "string"
          ? record.customCode
          : res.status === 404
            ? "not_found"
            : "api_error";
      const message =
        typeof record.message === "string"
          ? record.message
          : `Sourcify API responded with status ${res.status}`;
      throw new SourcifyApiError(code, message, res.status);
    }

    return body as T;
  }
}
