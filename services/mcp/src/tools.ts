import type {
  SourcifyClient,
  ContractListItem,
  ListContractsOptions,
} from "./SourcifyClient";
import { SourcifyApiError } from "./errors";
import type { VerificationStatus } from "./normalize";
import { toVerificationStatus } from "./normalize";

/**
 * Tool implementations. Each is a thin wrapper over {@link SourcifyClient}
 * that shapes the response into a stable, agent-friendly payload. No
 * verification or business logic lives here.
 */

export interface AbiResult {
  chainId: number;
  address: string;
  abi: unknown;
}

export async function getContractAbi(
  client: SourcifyClient,
  chainId: number,
  address: string,
): Promise<AbiResult> {
  const data = await client.getContract(chainId, address, { fields: ["abi"] });
  return { chainId, address, abi: data.abi };
}

export interface MetadataResult {
  chainId: number;
  address: string;
  metadata: unknown;
}

export async function getContractMetadata(
  client: SourcifyClient,
  chainId: number,
  address: string,
): Promise<MetadataResult> {
  const data = await client.getContract(chainId, address, {
    fields: ["metadata"],
  });
  return { chainId, address, metadata: data.metadata };
}

export interface SourceFilesResult {
  chainId: number;
  address: string;
  compilation: Record<string, unknown> | undefined;
  sources: Record<string, unknown> | undefined;
}

export async function getSourceFiles(
  client: SourcifyClient,
  chainId: number,
  address: string,
): Promise<SourceFilesResult> {
  const data = await client.getContract(chainId, address, {
    fields: ["sources", "compilation"],
  });
  return {
    chainId,
    address,
    compilation: data.compilation,
    sources: data.sources,
  };
}

export interface VerificationStatusResult {
  chainId: number;
  address: string;
  status: VerificationStatus;
  creationMatch?: string | null;
  runtimeMatch?: string | null;
  verifiedAt?: string;
}

export async function checkVerificationStatus(
  client: SourcifyClient,
  chainId: number,
  address: string,
): Promise<VerificationStatusResult> {
  try {
    // The match fields (match/creationMatch/runtimeMatch/verifiedAt) are part of
    // the always-returned minimal record; `match` is not a valid `fields`
    // selector, so we request the default response with no field selection.
    const data = await client.getContract(chainId, address);
    return {
      chainId,
      address,
      status: toVerificationStatus(data.match),
      creationMatch: data.creationMatch,
      runtimeMatch: data.runtimeMatch,
      verifiedAt: data.verifiedAt,
    };
  } catch (err) {
    // A 404 means the contract simply isn't verified on this chain — that's a
    // valid answer for a status check, not an error. Any other API error
    // (e.g. unsupported_chain) still propagates.
    if (err instanceof SourcifyApiError && err.code === "not_found") {
      return { chainId, address, status: "unverified" };
    }
    throw err;
  }
}

export interface ChainContractsResult {
  chainId: number;
  contracts: ContractListItem[];
  nextCursor: string | null;
}

export async function listChainContracts(
  client: SourcifyClient,
  chainId: number,
  opts: ListContractsOptions,
): Promise<ChainContractsResult> {
  const data = await client.listContracts(chainId, opts);
  const contracts = data.results ?? [];
  const last = contracts[contracts.length - 1];
  const nextCursor = last?.matchId ?? null;
  return { chainId, contracts, nextCursor };
}

export interface SupportedChain {
  chainId: number;
  name: string;
  supported: boolean;
}

export async function listSupportedChains(
  client: SourcifyClient,
): Promise<SupportedChain[]> {
  const chains = await client.getChains();
  return chains.map((c) => ({
    chainId: c.chainId,
    name: c.name,
    supported: c.supported,
  }));
}
