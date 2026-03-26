import type {
  SourcifyChainMap,
  APIKeyRPC,
  FetchRequestRPC,
  BaseRPC,
  SourcifyChainExtension,
  SourcifyRpc,
} from "@ethereum-sourcify/lib-sourcify";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import logger from "./common/logger";
import fs from "fs";
import path from "path";
import config from "config";

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

// Extended type for SourcifyChainsExtensionsObject that uses FetchRequestRPCWithHeaderEnvName

interface SourcifyChainsExtensionsObjectWithHeaderEnvName {
  [chainId: string]: Omit<SourcifyChainExtension, "rpc"> & {
    rpc?: Array<
      string | BaseRPC | APIKeyRPC | FetchRequestRPCWithHeaderEnvName
    >;
  };
}

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
 * Function to take the rpc format in sourcify-chains.json and convert it to the format SourcifyChain expects.
 * SourcifyChain expects  url strings or ethers.js FetchRequest objects.
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

export const sourcifyChainsMap: SourcifyChainMap = {};

/**
 * Loads the chain configuration and populates sourcifyChainsMap.
 *
 * Priority:
 *   1. Local sourcify-chains.json (self-hosted override)
 *   2. Remote URL from config.chains.remoteUrl (e.g. sourcifyeth/sourcify-chains repo)
 *
 * Called by Server.init() so that both the CLI and test fixtures initialize chains
 * through the same code path.
 */
export async function initializeSourcifyChains(): Promise<void> {
  let chainsExtensions: SourcifyChainsExtensionsObjectWithHeaderEnvName;

  // Priority 1: local sourcify-chains.json (self-hosted override)
  if (fs.existsSync(path.resolve(__dirname, "./sourcify-chains.json"))) {
    logger.warn("Overriding default chains: using sourcify-chains.json");
    chainsExtensions = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "./sourcify-chains.json"),
        "utf8",
      ),
    ) as SourcifyChainsExtensionsObjectWithHeaderEnvName;
  }
  // Priority 2: fetch from configured remote URL
  else {
    const remoteUrl = config.get<string>("chains.remoteUrl");
    if (!remoteUrl) {
      throw new Error(
        "chains.remoteUrl is not configured and no sourcify-chains.json override found. " +
          "Set chains.remoteUrl in the server config to the URL of the chains config file.",
      );
    }
    const maxAttempts = 3;
    const retryDelayMs = 3000;
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info(
          `Fetching chains config from ${remoteUrl} (attempt ${attempt}/${maxAttempts})`,
        );
        const response = await fetch(remoteUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch chains config: HTTP ${response.status} from ${remoteUrl}`,
          );
        }
        chainsExtensions =
          (await response.json()) as SourcifyChainsExtensionsObjectWithHeaderEnvName;
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < maxAttempts) {
          logger.warn(
            `Failed to fetch chains config, retrying in ${retryDelayMs / 1000}s`,
            { attempt, error: err.message },
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    if (!chainsExtensions!) {
      throw new Error(
        `Failed to fetch chains config after ${maxAttempts} attempts: ${lastError?.message}`,
      );
    }
  }

  // Clear the map before populating (allows re-initialization)
  for (const key of Object.keys(sourcifyChainsMap)) {
    delete sourcifyChainsMap[key];
  }

  // Add LOCAL_CHAINS in non-production
  if (process.env.NODE_ENV !== "production") {
    for (const chain of LOCAL_CHAINS) {
      sourcifyChainsMap[chain.chainId.toString()] = chain;
    }
  }

  // Build SourcifyChain objects directly from the loaded extensions
  for (const [chainIdStr, extension] of Object.entries(chainsExtensions)) {
    const chainId = parseInt(chainIdStr);
    // Skip local test chains (already added above)
    if (chainId in sourcifyChainsMap) continue;

    const rpcs = buildCustomRpcs(extension.rpc || []);
    sourcifyChainsMap[chainId] = new SourcifyChain({
      name: extension.sourcifyName,
      chainId,
      supported: extension.supported,
      rpcs,
      etherscanApi: extension.etherscanApi,
      fetchContractCreationTxUsing: extension.fetchContractCreationTxUsing,
    });
  }

  logger.info("SourcifyChains loaded", {
    totalChains: Object.keys(chainsExtensions).length,
  });
}
