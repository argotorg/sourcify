import type {
  Chain,
  SourcifyChainExtension,
  APIKeyRPC,
  BaseRPC,
  FetchRequestRPC,
} from "@ethereum-sourcify/lib-sourcify";
import logger from "./common/logger";

// Extended FetchRequestRPC variant used by sourcify-chains-default.json,
// where header values can be sourced from environment variables. Mirrors the
// type defined in sourcify-chains.ts so a remote registry can serve the same
// shape as the local sourcify-chains-default.json.
type FetchRequestRPCWithHeaderEnvName = Omit<FetchRequestRPC, "headers"> & {
  headers?: Array<{
    headerName: string;
    headerValue?: string;
    headerEnvName?: string;
  }>;
};

// Sourcify-extension variant accepted from a remote registry. Same as
// SourcifyChainExtension but with the extended FetchRequestRPC variant.
export type RemoteSourcifyExtension = Omit<SourcifyChainExtension, "rpc"> & {
  rpc?: Array<string | BaseRPC | APIKeyRPC | FetchRequestRPCWithHeaderEnvName>;
};

// One entry in the remote chain registry response. Compatible with
// chainlist.org's chains.json: only `chainId` is required; `rpc` is recommended
// but optional. An optional `hidden` flag mirrors the chainlist convention for
// chains that should not be advertised. An optional `sourcifyExtension` lets
// the registry serve full sourcify-chains-default.json semantics (api keys,
// Etherscan support, fetchContractCreationTxUsing, etc.) when needed.
export interface RemoteChainEntry {
  chainId: number;
  name?: string;
  title?: string;
  shortName?: string;
  network?: string;
  networkId?: number;
  infoURL?: string;
  faucets?: string[];
  nativeCurrency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpc?: string[];
  hidden?: boolean;
  // Optional. The remote registry may omit `sourcifyName` / `supported`; we
  // fill in defaults from the entry when they are missing.
  sourcifyExtension?: Partial<RemoteSourcifyExtension>;
}

// The remote payload is an object keyed by chain id (string) -> entry, matching
// chainlist.org's representation of chains.json.
export type RemoteChainRegistryResponse = Record<string, RemoteChainEntry>;

export interface ChainRegistryOptions {
  url: string;
  authToken?: string;
  timeoutMs?: number;
}

export interface ChainRegistryResult {
  // Entries to merge into the chains.json layer (Chain metadata).
  chainsJsonAdditions: Chain[];
  // Entries to merge into the sourcifyChainsExtensions layer.
  extensionAdditions: Record<string, RemoteSourcifyExtension>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isHttpUrl = (value: string): boolean =>
  value.startsWith("http://") || value.startsWith("https://");

const isRemoteChainEntry = (value: unknown): value is RemoteChainEntry => {
  if (!isObject(value)) return false;
  if (typeof value.chainId !== "number") return false;
  if (value.rpc !== undefined && !isStringArray(value.rpc)) return false;
  if (value.hidden !== undefined && typeof value.hidden !== "boolean")
    return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  return true;
};

const parseResponse = (raw: unknown): RemoteChainRegistryResponse => {
  if (!isObject(raw)) {
    throw new Error("Remote chain registry response is not a JSON object");
  }
  const out: RemoteChainRegistryResponse = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!isRemoteChainEntry(entry)) {
      logger.warn("chainRegistry: skipping invalid entry", { key });
      continue;
    }
    out[key] = entry;
  }
  return out;
};

const buildChainFromEntry = (entry: RemoteChainEntry): Chain => ({
  name: entry.name ?? `Chain ${entry.chainId}`,
  title: entry.title,
  chainId: entry.chainId,
  shortName: entry.shortName,
  network: entry.network,
  networkId: entry.networkId,
  nativeCurrency: entry.nativeCurrency,
  rpc: entry.rpc ?? [],
  faucets: entry.faucets,
  infoURL: entry.infoURL,
});

const buildExtensionFromEntry = (
  entry: RemoteChainEntry,
  httpRpcs: string[],
): RemoteSourcifyExtension => {
  if (entry.sourcifyExtension) {
    // The remote registry provided a full Sourcify extension. Trust it,
    // but ensure `sourcifyName` and `supported` have sensible defaults.
    const ext = entry.sourcifyExtension;
    return {
      ...ext,
      sourcifyName: ext.sourcifyName ?? entry.name ?? `Chain ${entry.chainId}`,
      supported: ext.supported ?? true,
    };
  }
  return {
    sourcifyName: entry.name ?? `Chain ${entry.chainId}`,
    supported: true,
    rpc: httpRpcs,
  };
};

/**
 * Fetches a remote chain registry and converts it to additions that can be
 * merged into the local chains.json layer and sourcifyChainsExtensions layer.
 *
 * The caller is responsible for enforcing static-vs-remote precedence (i.e.
 * not overwriting a chainId that already exists locally).
 *
 * On any failure (network error, non-2xx, malformed payload, timeout) this
 * function logs a warning and returns empty additions. Callers that need to
 * fail-fast should check the result emptiness or wrap with their own logic.
 */
export async function fetchChainRegistry(
  options: ChainRegistryOptions,
): Promise<ChainRegistryResult> {
  const empty: ChainRegistryResult = {
    chainsJsonAdditions: [],
    extensionAdditions: {},
  };

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.authToken) {
    headers["Authorization"] = `Bearer ${options.authToken}`;
  }

  let response: Response;
  try {
    response = await fetch(options.url, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn("chainRegistry: fetch failed", {
      url: options.url,
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }

  if (!response.ok) {
    logger.warn("chainRegistry: non-2xx response", {
      url: options.url,
      status: response.status,
    });
    return empty;
  }

  let parsed: RemoteChainRegistryResponse;
  try {
    const raw = (await response.json()) as unknown;
    parsed = parseResponse(raw);
  } catch (error) {
    logger.warn("chainRegistry: failed to parse response", {
      url: options.url,
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }

  const chainsJsonAdditions: Chain[] = [];
  const extensionAdditions: Record<string, RemoteSourcifyExtension> = {};

  for (const [key, entry] of Object.entries(parsed)) {
    if (entry.hidden) {
      logger.debug("chainRegistry: skipping hidden chain", {
        chainId: entry.chainId,
        key,
      });
      continue;
    }

    const httpRpcs = (entry.rpc ?? []).filter(isHttpUrl);
    const hasUsableRpc =
      httpRpcs.length > 0 || (entry.sourcifyExtension?.rpc?.length ?? 0) > 0;

    if (!hasUsableRpc) {
      logger.warn("chainRegistry: skipping chain with no usable RPC", {
        chainId: entry.chainId,
        key,
      });
      continue;
    }

    chainsJsonAdditions.push(buildChainFromEntry(entry));
    extensionAdditions[entry.chainId.toString()] = buildExtensionFromEntry(
      entry,
      httpRpcs,
    );
  }

  logger.info("chainRegistry: loaded remote chains", {
    url: options.url,
    count: chainsJsonAdditions.length,
  });

  return { chainsJsonAdditions, extensionAdditions };
}
