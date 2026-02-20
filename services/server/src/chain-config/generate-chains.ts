/**
 * Chain configuration generation script.
 *
 * Fetches chain data from multiple provider and block explorer APIs,
 * merges with chain metadata from chainid.network, and writes
 * generated-chains.json.
 *
 * Run via: npm run generate:chains
 */

import dotenv from "dotenv";
dotenv.config();

import {
  fetchQuickNodeChains,
  QuickNodeChainData,
} from "./providers/quicknode";
import { fetchDrpcChains, DrpcChainData } from "./providers/drpc";
import {
  fetchEtherscanChains,
  EtherscanChainData,
} from "./block-explorers/etherscan";
import {
  fetchBlockscoutChains,
  BlockscoutChainData,
} from "./block-explorers/blockscout";
import {
  fetchRoutescanChains,
  RoutescanChainData,
} from "./block-explorers/routescan";
import fs from "fs";
import path from "path";
import { DEPRECATED_CHAIN_IDS } from "./deprecated-chains";

const CHAINID_NETWORK_URL = "https://chainid.network/chains.json";
const CHAIN_OVERRIDES_PATH = path.resolve(__dirname, "chain-overrides.json");

interface ChainMetadata {
  name: string;
  chainId: number;
  shortName?: string;
  nativeCurrency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpc: string[];
  faucets?: string[];
  infoURL?: string;
  networkId?: number;
}

export interface GeneratedChainEntry {
  // Chain metadata from chainid.network
  name: string;
  chainId: number;
  shortName?: string;
  rpc: string[];

  // RPC provider support
  rpcProviders: {
    quicknode?: QuickNodeChainData;
    drpc?: DrpcChainData;
  };

  // Block explorer support
  blockExplorers: {
    etherscan?: EtherscanChainData;
    blockscout?: BlockscoutChainData;
    routescan?: RoutescanChainData;
  };
}

interface GeneratedChainsFile {
  generatedAt: string;
  chains: Record<string, GeneratedChainEntry>;
}

async function fetchChainMetadata(): Promise<Map<number, ChainMetadata>> {
  const response = await fetch(CHAINID_NETWORK_URL);
  if (!response.ok) {
    throw new Error(
      `chainid.network returned ${response.status}: ${await response.text()}`,
    );
  }

  const chains = (await response.json()) as ChainMetadata[];
  const result = new Map<number, ChainMetadata>();

  for (const chain of chains) {
    result.set(chain.chainId, chain);
  }

  return result;
}

type FetchResult<T> = {
  name: string;
  data: Map<number, T> | null;
  error?: string;
};

async function safeFetch<T>(
  name: string,
  fetchFn: () => Promise<Map<number, T>>,
): Promise<FetchResult<T>> {
  try {
    const data = await fetchFn();
    console.log(`  ${name}: ${data.size} chains`);
    return { name, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  ${name}: FAILED - ${message}`);
    return { name, data: null, error: message };
  }
}

async function main() {
  const quicknodeApiKey = process.env.QUICKNODE_CONSOLE_API_KEY;
  if (!quicknodeApiKey) {
    console.warn(
      "Warning: QUICKNODE_CONSOLE_API_KEY not set, QuickNode data will be skipped",
    );
  }

  console.log("Fetching chain metadata from chainid.network...");
  const chainMetadata = await fetchChainMetadata();
  console.log(`  Found ${chainMetadata.size} chains`);

  console.log("\nFetching provider and explorer data...");

  const [quicknodeResult, drpcResult, etherscanResult, blockscoutResult, routescanResult] =
    await Promise.all([
      quicknodeApiKey
        ? safeFetch("QuickNode", () => fetchQuickNodeChains(quicknodeApiKey))
        : Promise.resolve({
            name: "QuickNode",
            data: null,
            error: "No API key",
          } as FetchResult<QuickNodeChainData>),
      safeFetch("dRPC", fetchDrpcChains),
      safeFetch("Etherscan", fetchEtherscanChains),
      safeFetch("Blockscout", fetchBlockscoutChains),
      safeFetch("Routescan", fetchRoutescanChains),
    ]);

  // Load chain-overrides.json to get the manually managed chain IDs
  const chainOverridesRaw = JSON.parse(fs.readFileSync(CHAIN_OVERRIDES_PATH, "utf8")) as Record<string, unknown>;
  const overrideChainIds = new Set<number>(
    Object.keys(chainOverridesRaw).map((id) => parseInt(id, 10)),
  );
  console.log(`\nLoaded ${overrideChainIds.size} chains from chain-overrides.json`);

  const deprecatedChainIds = new Set<number>(Object.keys(DEPRECATED_CHAIN_IDS).map(Number));

  // Only include chains that have an RPC provider (QuickNode or dRPC) OR are in chain-overrides.json.
  // A block explorer alone does not qualify a chain for inclusion.
  // Deprecated chains are excluded regardless of provider support.
  const relevantChainIds = new Set<number>(overrideChainIds);
  for (const result of [quicknodeResult, drpcResult]) {
    if (result.data) {
      for (const chainId of result.data.keys()) {
        if (!deprecatedChainIds.has(chainId)) {
          relevantChainIds.add(chainId);
        }
      }
    }
  }

  console.log(`Building generated-chains.json for ${relevantChainIds.size} relevant chains...`);

  const chains: Record<string, GeneratedChainEntry> = {};

  for (const chainId of [...relevantChainIds].sort((a, b) => a - b)) {
    const metadata = chainMetadata.get(chainId);

    const rpcProviders: GeneratedChainEntry["rpcProviders"] = {};
    if (quicknodeResult.data?.has(chainId)) {
      rpcProviders.quicknode = quicknodeResult.data.get(chainId)!;
    }
    if (drpcResult.data?.has(chainId)) {
      rpcProviders.drpc = drpcResult.data.get(chainId)!;
    }

    // Only attach block explorer data for relevant chains
    const blockExplorers: GeneratedChainEntry["blockExplorers"] = {};
    if (etherscanResult.data?.has(chainId)) {
      blockExplorers.etherscan = etherscanResult.data.get(chainId)!;
    }
    if (blockscoutResult.data?.has(chainId)) {
      blockExplorers.blockscout = blockscoutResult.data.get(chainId)!;
    }
    if (routescanResult.data?.has(chainId)) {
      blockExplorers.routescan = routescanResult.data.get(chainId)!;
    }

    chains[chainId.toString()] = {
      name: metadata?.name ?? `Chain ${chainId}`,
      chainId,
      shortName: metadata?.shortName,
      rpc: metadata?.rpc ?? [],
      rpcProviders,
      blockExplorers,
    };
  }

  const output: GeneratedChainsFile = {
    generatedAt: new Date().toISOString(),
    chains,
  };

  const outputPath = path.resolve(__dirname, "generated-chains.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");

  const chainCount = Object.keys(chains).length;
  const withProviders = Object.values(chains).filter(
    (c) => Object.keys(c.rpcProviders).length > 0,
  ).length;
  const withExplorers = Object.values(chains).filter(
    (c) => Object.keys(c.blockExplorers).length > 0,
  ).length;

  console.log(`\nWrote ${outputPath}`);
  console.log(`  Total chains: ${chainCount}`);
  console.log(`  With RPC providers: ${withProviders}`);
  console.log(`  With block explorers: ${withExplorers}`);

  // Report any failed fetches
  const failures = [quicknodeResult, drpcResult, etherscanResult, blockscoutResult, routescanResult]
    .filter((r) => r.data === null);
  if (failures.length > 0) {
    console.warn(`\nWarning: ${failures.length} source(s) failed:`);
    failures.forEach((f) => console.warn(`  - ${f.name}: ${f.error}`));
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
