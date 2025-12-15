import type {
  SourcifyChainMap,
  Chain,
  APIKeyRPC,
  FetchRequestRPC,
  BaseRPC,
  SourcifyChainExtension,
  SourcifyRpc,
} from "@ethereum-sourcify/lib-sourcify";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import chainsRaw from "./chains.json";
import extraChainsRaw from "./extra-chains.json";
import rawSourcifyChainExtentions from "./sourcify-chains-default.json";
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

// Extended type for SourcifyChainsExtensionsObject that uses FetchRequestRPCWithHeaderEnvName

interface SourcifyChainsExtensionsObjectWithHeaderEnvName {
  [chainId: string]: Omit<SourcifyChainExtension, "rpc"> & {
    rpc?: Array<
      string | BaseRPC | APIKeyRPC | FetchRequestRPCWithHeaderEnvName
    >;
  };
}

let sourcifyChainsExtensions: SourcifyChainsExtensionsObjectWithHeaderEnvName =
  {};

// If sourcify-chains.json exists, override sourcify-chains-default.json
if (fs.existsSync(path.resolve(__dirname, "./sourcify-chains.json"))) {
  logger.warn(
    "Overriding default chains: using sourcify-chains.json instead of sourcify-chains-default.json",
  );
  const rawSourcifyChainExtentionsFromFile = fs.readFileSync(
    path.resolve(__dirname, "./sourcify-chains.json"),
    "utf8",
  );
  sourcifyChainsExtensions = JSON.parse(
    rawSourcifyChainExtentionsFromFile,
  ) as SourcifyChainsExtensionsObjectWithHeaderEnvName;
}
// sourcify-chains-default.json
else {
  sourcifyChainsExtensions =
    rawSourcifyChainExtentions as SourcifyChainsExtensionsObjectWithHeaderEnvName;
}

const chainMapById = new Map<number, Chain>();
// Add chains.json from ethereum-lists (chainId.network/chains.json)
chainsRaw.forEach((chain) => chainMapById.set(chain.chainId, chain));
// Chains that we decide to support but that are not in chains.json
extraChainsRaw.forEach((chain) => {
  // Skip if chainsRaw already defines this chainId so canonical entry wins
  if (!chainMapById.has(chain.chainId)) {
    chainMapById.set(chain.chainId, chain);
  }
});
const allChains = Array.from(chainMapById.values());

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

const sourcifyChainsMap: SourcifyChainMap = {};

// Add test chains too if developing or testing
if (process.env.NODE_ENV !== "production") {
  for (const chain of LOCAL_CHAINS) {
    sourcifyChainsMap[chain.chainId.toString()] = chain;
  }
}

// iterate over chainid.network's chains.json file and get the chains included in sourcify-chains.json.
// Merge the chains.json object with the values from sourcify-chains.json
// Must iterate over all chains because it's not a mapping but an array.
for (const chain of allChains) {
  const chainId = chain.chainId;
  if (chainId in sourcifyChainsMap) {
    // Don't throw on test chains in development, override the chain.json item as test chains are found in chains.json.
    if (
      process.env.NODE_ENV !== "production" &&
      LOCAL_CHAINS.map((c) => c.chainId).includes(chainId)
    ) {
      // do nothing.
    } else {
      const err = `Corrupt chains file (chains.json): multiple chains have the same chainId: ${chainId}`;
      throw new Error(err);
    }
  }

  if (chainId in sourcifyChainsExtensions) {
    const sourcifyExtension = sourcifyChainsExtensions[chainId];

    let rpcs: SourcifyRpc[] = [];
    if (sourcifyExtension.rpc) {
      rpcs = buildCustomRpcs(sourcifyExtension.rpc);
    }
    // Fallback to rpcs of chains.json
    if (!rpcs.length) {
      rpcs = buildCustomRpcs(chain.rpc);
    }

    // sourcifyExtension is spread later to overwrite chains.json values
    // Exclude rpc from sourcifyExtension as we now use rpcs
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { rpc: _rpc, ...sourcifyExtensionWithoutRpc } = sourcifyExtension;
    const sourcifyChain = new SourcifyChain({
      ...chain,
      ...sourcifyExtensionWithoutRpc,
      rpcs,
    });
    sourcifyChainsMap[chainId] = sourcifyChain;
  }
}

// Check if all chains in sourcify-chains.json are in chains.json
const missingChains = [];
for (const chainId in sourcifyChainsExtensions) {
  if (!sourcifyChainsMap[chainId]) {
    missingChains.push(chainId);
  }
}
if (missingChains.length > 0) {
  // Don't let CircleCI pass for the main repo if sourcify-chains.json has chains that are not in chains.json
  if (process.env.CIRCLE_PROJECT_REPONAME === "sourcify") {
    throw new Error(
      `Some of the chains in sourcify-chains.json are not in chains.json: ${missingChains.join(
        ",",
      )}`,
    );
  }
  // Don't throw for forks or others running Sourcify, instead add them to sourcifyChainsMap
  else {
    logger.warn(
      `Some of the chains in sourcify-chains.json are not in chains.json`,
      missingChains,
    );
    missingChains.forEach((chainId) => {
      const chain = sourcifyChainsExtensions[chainId];
      if (!chain.rpc) {
        throw new Error(
          `Chain ${chainId} is missing rpc in sourcify-chains.json`,
        );
      }
      const rpcs = buildCustomRpcs(chain.rpc);
      sourcifyChainsMap[chainId] = new SourcifyChain({
        name: chain.sourcifyName,
        chainId: parseInt(chainId),
        supported: chain.supported,
        rpcs,
        fetchContractCreationTxUsing: chain.fetchContractCreationTxUsing,
      });
    });
  }
}

export { sourcifyChainsMap };
