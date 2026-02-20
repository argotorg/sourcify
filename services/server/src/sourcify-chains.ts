import type {
  SourcifyChainMap,
  Chain,
  APIKeyRPC,
  FetchRequestRPC,
  BaseRPC,
  SourcifyChainExtension,
  SourcifyRpc,
  FetchContractCreationTxMethods,
  TraceSupport,
} from "@ethereum-sourcify/lib-sourcify";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import extraChainsRaw from "./extra-chains.json";
import logger from "./common/logger";
import fs from "fs";
import path from "path";

import dotenv from "dotenv";

dotenv.config();

// Extended type for FetchRequestRPC with headerEnvName
type FetchRequestRPCWithHeaderEnvName = Omit<FetchRequestRPC, "headers"> & {
  headers?: Array<{
    headerName: string;
    headerValue?: string;
    headerEnvName?: string;
  }>;
};

// Type for the chain-overrides.json file
interface ChainOverride {
  sourcifyName: string;
  supported: boolean;
  etherscanApiKeyEnvName?: string;
  traceSupport?: TraceSupport;
  fetchContractCreationTxUsing?: FetchContractCreationTxMethods;
  rpc?: Array<
    string | BaseRPC | APIKeyRPC | FetchRequestRPCWithHeaderEnvName
  >;
}

interface ChainOverridesFile {
  [chainId: string]: ChainOverride;
}

// Type for the generated-chains.json file
interface GeneratedChainEntry {
  name: string;
  chainId: number;
  shortName?: string;
  rpc: string[];
  rpcProviders: {
    quicknode?: { networkSlug: string };
    drpc?: { shortName: string };
  };
  blockExplorers: {
    etherscan?: { apiUrl: string; chainName: string; blockExplorerUrl: string };
    blockscout?: { url: string; hostedBy: string; name: string };
    routescan?: { workspace: string; name: string };
  };
}

interface GeneratedChainsFile {
  generatedAt: string;
  chains: Record<string, GeneratedChainEntry>;
}

// Extended type for SourcifyChainsExtensionsObject that uses FetchRequestRPCWithHeaderEnvName (for custom deployment override)
interface SourcifyChainsExtensionsObjectWithHeaderEnvName {
  [chainId: string]: Omit<SourcifyChainExtension, "rpc"> & {
    rpc?: Array<
      string | BaseRPC | APIKeyRPC | FetchRequestRPCWithHeaderEnvName
    >;
  };
}

// Load generated-chains.json
let generatedChains: GeneratedChainsFile;
const generatedChainsPath = path.resolve(
  __dirname,
  "./chain-config/generated-chains.json",
);
if (fs.existsSync(generatedChainsPath)) {
  generatedChains = JSON.parse(
    fs.readFileSync(generatedChainsPath, "utf8"),
  ) as GeneratedChainsFile;
} else {
  logger.warn(
    "generated-chains.json not found. Run 'npm run generate:chains' to create it.",
  );
  generatedChains = { generatedAt: "", chains: {} };
}

// Load chain overrides
let chainOverrides: ChainOverridesFile;
const chainOverridesPath = path.resolve(
  __dirname,
  "./chain-config/chain-overrides.json",
);
if (fs.existsSync(chainOverridesPath)) {
  chainOverrides = JSON.parse(
    fs.readFileSync(chainOverridesPath, "utf8"),
  ) as ChainOverridesFile;
} else {
  logger.warn("chain-overrides.json not found.");
  chainOverrides = {};
}

// Build chain metadata map from generated-chains.json + extra-chains.json
const chainMetadataById = new Map<number, Chain>();

// Add chains from generated-chains.json (which includes chainid.network data)
for (const [chainIdStr, entry] of Object.entries(generatedChains.chains)) {
  const chainId = parseInt(chainIdStr, 10);
  chainMetadataById.set(chainId, {
    name: entry.name,
    chainId,
    shortName: entry.shortName,
    rpc: entry.rpc,
  });
}

// Add extra-chains.json (chains not in chainid.network)
extraChainsRaw.forEach((chain) => {
  if (!chainMetadataById.has(chain.chainId)) {
    chainMetadataById.set(chain.chainId, chain);
  }
});

export const LOCAL_CHAINS: SourcifyChain[] = [
  new SourcifyChain({
    name: "Ganache Localhost",
    shortName: "Ganache",
    chainId: 1337,
    faucets: [],
    infoURL: "localhost",
    nativeCurrency: { name: "localETH", symbol: "localETH", decimals: 18 },
    network: "testnet",
    networkId: 1337,
    rpcs: [
      {
        rpc: `http://localhost:8545`,
        urlWithoutApiKey: `http://localhost:8545`,
        maskedUrl: `http://localhost:8545`,
      },
    ],
    supported: true,
  }),
  new SourcifyChain({
    name: "Hardhat Network Localhost",
    shortName: "Hardhat Network",
    chainId: 31337,
    faucets: [],
    infoURL: "localhost",
    nativeCurrency: { name: "localETH", symbol: "localETH", decimals: 18 },
    network: "testnet",
    networkId: 31337,
    rpcs: [
      {
        rpc: `http://localhost:8545`,
        urlWithoutApiKey: `http://localhost:8545`,
        maskedUrl: `http://localhost:8545`,
      },
    ],
    supported: true,
  }),
];

/**
 * Function to take the rpc format in config files and convert it to the format SourcifyChain expects.
 * SourcifyChain expects url strings or ethers.js FetchRequest objects.
 */
function buildCustomRpcs(
  sourcifyRpcs: Array<
    string | BaseRPC | APIKeyRPC | FetchRequestRPCWithHeaderEnvName
  >,
): SourcifyRpc[] {
  const rpcs: SourcifyRpc[] = [];

  sourcifyRpcs.forEach((sourcifyRpc) => {
    // simple url, can't have traceSupport
    if (typeof sourcifyRpc === "string") {
      rpcs.push({
        rpc: sourcifyRpc,
        urlWithoutApiKey: sourcifyRpc,
        maskedUrl: sourcifyRpc,
        traceSupport: undefined,
      });
      return;
    } else if (sourcifyRpc.type === "BaseRPC") {
      rpcs.push({
        rpc: sourcifyRpc.url,
        urlWithoutApiKey: sourcifyRpc.url,
        maskedUrl: sourcifyRpc.url,
        traceSupport: sourcifyRpc.traceSupport,
      });
      return;
    } else if (sourcifyRpc.type === "APIKeyRPC") {
      // Fill in the api keys
      const apiKey =
        process.env[sourcifyRpc.apiKeyEnvName] || process.env["API_KEY"] || "";
      if (!apiKey) {
        // Just warn on CI or development
        if (
          process.env.CI === "true" ||
          process.env.NODE_ENV !== "production"
        ) {
          logger.warn(
            `API key not found for ${sourcifyRpc.apiKeyEnvName} on ${sourcifyRpc.url}, skipping on CI or development`,
          );
          return;
        } else {
          throw new Error(`API key not found for ${sourcifyRpc.apiKeyEnvName}`);
        }
      }
      let secretUrl = sourcifyRpc.url.replace("{API_KEY}", apiKey);
      const maskedApiKey =
        apiKey.length > 4
          ? apiKey.slice(0, 4) + "*".repeat(apiKey.length - 4)
          : "*".repeat(apiKey.length);
      let maskedUrl = sourcifyRpc.url.replace("{API_KEY}", maskedApiKey);

      const subDomain = process.env[sourcifyRpc.subDomainEnvName || ""];
      if (subDomain) {
        // subDomain is optional
        secretUrl = secretUrl.replace("{SUBDOMAIN}", subDomain);
        const maskedSubDomain =
          subDomain.length > 4
            ? subDomain.slice(0, 4) + "*".repeat(subDomain.length - 4)
            : "*".repeat(subDomain.length);
        maskedUrl = maskedUrl.replace("{SUBDOMAIN}", maskedSubDomain);
      }
      rpcs.push({
        rpc: secretUrl,
        urlWithoutApiKey: sourcifyRpc.url,
        maskedUrl: maskedUrl,
        traceSupport: sourcifyRpc.traceSupport,
      });
      return;
    } else if (sourcifyRpc.type === "FetchRequest") {
      // Remove headerEnvName before adding to rpcs
      const fetchRequestRpc: FetchRequestRPC = {
        type: "FetchRequest",
        url: sourcifyRpc.url,
        traceSupport: sourcifyRpc.traceSupport,
        headers: sourcifyRpc.headers?.map(
          // Replace headerEnvName with headerValue in rpc
          ({ headerName, headerValue, headerEnvName }) => {
            if (headerValue) {
              if (headerEnvName) {
                logger.warn(
                  `Header value already set for ${headerName} on ${sourcifyRpc.url}, ignoring headerEnvName`,
                  {
                    url: sourcifyRpc.url,
                    headerName,
                    headerEnvName,
                  },
                );
              }
              return {
                headerName,
                headerValue: headerValue,
              };
            }

            const envValue = process.env[headerEnvName || ""] || "";
            if (!envValue) {
              logger.warn(
                `No env value found for ${headerEnvName} on ${sourcifyRpc.url}, leaving value empty`,
                {
                  url: sourcifyRpc.url,
                  headerName,
                  headerEnvName,
                },
              );
            }
            return {
              headerName,
              headerValue: envValue,
            };
          },
        ),
      };
      rpcs.push({
        rpc: fetchRequestRpc,
        urlWithoutApiKey: sourcifyRpc.url,
        maskedUrl: sourcifyRpc.url,
        traceSupport: sourcifyRpc.traceSupport,
      });
      return;
    }
    throw new Error(`Invalid rpc type: ${JSON.stringify(sourcifyRpc)}`);
  });
  return rpcs;
}

// QuickNode network slugs that require /ext/bc/C/rpc/ path suffix
const QUICKNODE_SUBNETS = new Set(["avalanche-mainnet", "avalanche-testnet", "flare-mainnet", "flare-coston2"]);

/**
 * Build QuickNode RPC config for a chain from generated data.
 *
 * URL exceptions:
 * - "mainnet" (Ethereum): no network slug in subdomain → {SUBDOMAIN}.quiknode.pro/{API_KEY}
 * - Avalanche/Flare: require /ext/bc/C/rpc/ path suffix
 */
function buildQuickNodeRpc(
  networkSlug: string,
  traceSupport?: TraceSupport,
): APIKeyRPC {
  let url: string;
  if (networkSlug === "mainnet") {
    // Ethereum mainnet: slug not embedded in subdomain
    url = `https://{SUBDOMAIN}.quiknode.pro/{API_KEY}`;
  } else if (QUICKNODE_SUBNETS.has(networkSlug)) {
    url = `https://{SUBDOMAIN}.${networkSlug}.quiknode.pro/{API_KEY}/ext/bc/C/rpc/`;
  } else {
    url = `https://{SUBDOMAIN}.${networkSlug}.quiknode.pro/{API_KEY}`;
  }
  return {
    type: "APIKeyRPC",
    url,
    apiKeyEnvName: "QUICKNODE_API_KEY",
    subDomainEnvName: "QUICKNODE_SUBDOMAIN",
    traceSupport,
  };
}

/**
 * Build dRPC RPC config for a chain from generated data.
 */
function buildDrpcRpc(shortName: string): APIKeyRPC {
  return {
    type: "APIKeyRPC",
    url: `https://lb.drpc.live/${shortName}/{API_KEY}`,
    apiKeyEnvName: "DRPC_API_KEY",
  };
}

/**
 * Auto-build fetchContractCreationTxUsing from generated block explorer data,
 * merged with manual overrides for niche explorers.
 */
function buildFetchContractCreationTxUsing(
  generated: GeneratedChainEntry | undefined,
  override: ChainOverride | undefined,
  hasEtherscanApi: boolean,
): FetchContractCreationTxMethods | undefined {
  const methods: FetchContractCreationTxMethods = {};

  // Auto: blockscoutApi from generated
  if (generated?.blockExplorers?.blockscout?.url) {
    methods.blockscoutApi = {
      url: generated.blockExplorers.blockscout.url,
    };
  }

  // Auto: routescanApi from generated
  if (generated?.blockExplorers?.routescan) {
    const workspace = generated.blockExplorers.routescan.workspace;
    if (workspace === "mainnet" || workspace === "testnet") {
      methods.routescanApi = {
        type: workspace,
      };
    }
  }

  // Auto: etherscanApi if chain has etherscan support
  if (hasEtherscanApi) {
    methods.etherscanApi = true;
  }

  // Manual: merge niche explorer methods from override
  if (override?.fetchContractCreationTxUsing) {
    Object.assign(methods, override.fetchContractCreationTxUsing);
  }

  return Object.keys(methods).length > 0 ? methods : undefined;
}

const sourcifyChainsMap: SourcifyChainMap = {};

// Add test chains too if developing or testing
if (process.env.NODE_ENV !== "production") {
  for (const chain of LOCAL_CHAINS) {
    sourcifyChainsMap[chain.chainId.toString()] = chain;
  }
}

// Check if custom sourcify-chains.json exists (self-hosted deployment override)
if (fs.existsSync(path.resolve(__dirname, "./sourcify-chains.json"))) {
  logger.warn(
    "Overriding default chains: using sourcify-chains.json (custom deployment override)",
  );
  const rawOverrideFile = fs.readFileSync(
    path.resolve(__dirname, "./sourcify-chains.json"),
    "utf8",
  );
  const customExtensions = JSON.parse(
    rawOverrideFile,
  ) as SourcifyChainsExtensionsObjectWithHeaderEnvName;

  // Use the legacy merge logic for custom deployments
  for (const [chainIdStr, extension] of Object.entries(customExtensions)) {
    const chainId = parseInt(chainIdStr, 10);
    const chainMetadata = chainMetadataById.get(chainId);

    let rpcs: SourcifyRpc[] = [];
    if (extension.rpc) {
      rpcs = buildCustomRpcs(extension.rpc);
    }
    // Add public RPCs from chain metadata as fallback
    if (chainMetadata?.rpc) {
      rpcs = [...rpcs, ...buildCustomRpcs(chainMetadata.rpc)];
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { rpc: _rpc, ...extensionWithoutRpc } = extension;

    if (chainMetadata) {
      sourcifyChainsMap[chainIdStr] = new SourcifyChain({
        ...chainMetadata,
        ...extensionWithoutRpc,
        rpcs,
      });
    } else {
      // Chain not in chainid.network, create minimal entry
      sourcifyChainsMap[chainIdStr] = new SourcifyChain({
        name: extension.sourcifyName,
        chainId,
        supported: extension.supported,
        rpcs,
        fetchContractCreationTxUsing: extension.fetchContractCreationTxUsing,
        etherscanApi: extension.etherscanApi,
      });
    }
  }
} else {
  // Standard mode: use generated-chains.json + chain-overrides.json
  for (const [chainIdStr, override] of Object.entries(chainOverrides)) {
    if (!override.supported) {
      continue;
    }

    const chainId = parseInt(chainIdStr, 10);
    const chainMetadata = chainMetadataById.get(chainId);
    const generated = generatedChains.chains[chainIdStr];

    // Build RPCs in priority order
    let rpcs: SourcifyRpc[] = [];

    // 1. Manual RPCs from override (ethpandaops, etc.)
    if (override.rpc) {
      rpcs = [...rpcs, ...buildCustomRpcs(override.rpc)];
    }

    // 2. QuickNode RPC (from generated slug + traceSupport from override)
    if (generated?.rpcProviders?.quicknode) {
      rpcs = [
        ...rpcs,
        ...buildCustomRpcs([
          buildQuickNodeRpc(
            generated.rpcProviders.quicknode.networkSlug,
            override.traceSupport,
          ),
        ]),
      ];
    }

    // 3. dRPC RPC (from generated shortName)
    if (generated?.rpcProviders?.drpc) {
      rpcs = [
        ...rpcs,
        ...buildCustomRpcs([
          buildDrpcRpc(generated.rpcProviders.drpc.shortName),
        ]),
      ];
    }

    // 4. Public RPCs from chainid.network (fallback)
    if (chainMetadata?.rpc) {
      rpcs = [...rpcs, ...buildCustomRpcs(chainMetadata.rpc)];
    }

    // Build etherscanApi config
    const hasEtherscanSupport = !!generated?.blockExplorers?.etherscan;
    const etherscanApi = hasEtherscanSupport
      ? {
          supported: true,
          apiKeyEnvName: override.etherscanApiKeyEnvName,
        }
      : undefined;

    // Build fetchContractCreationTxUsing
    const fetchContractCreationTxUsing =
      buildFetchContractCreationTxUsing(generated, override, hasEtherscanSupport);

    const baseChain: Chain = chainMetadata || {
      name: override.sourcifyName,
      chainId,
      rpc: [],
    };

    sourcifyChainsMap[chainIdStr] = new SourcifyChain({
      ...baseChain,
      supported: true,
      rpcs,
      etherscanApi,
      fetchContractCreationTxUsing,
    });
  }
}

export { sourcifyChainsMap };
