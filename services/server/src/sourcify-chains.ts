import {
  SourcifyChain,
  SourcifyChainMap,
  Chain,
  APIKeyRPC,
  FetchRequestRPC,
  BaseRPC,
  TraceSupportedRPC,
  SourcifyChainExtension,
} from "@ethereum-sourcify/lib-sourcify";
import chainsRaw from "./chains.json";
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

// chains.json from ethereum-lists (chainId.network/chains.json)
const allChains = chainsRaw as Chain[];

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
    rpc: [`http://localhost:8545`],
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
    rpc: [`http://localhost:8545`],
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
) {
  const traceSupportedRPCs: TraceSupportedRPC[] = [];
  const rpc: (string | FetchRequestRPCWithHeaderEnvName)[] = [];
  const rpcWithoutApiKeys: string[] = [];
  sourcifyRpcs.forEach((sourcifyRpc, index) => {
    // simple url, can't have traceSupport
    if (typeof sourcifyRpc === "string") {
      rpc.push(sourcifyRpc);
      rpcWithoutApiKeys.push(sourcifyRpc);
      return;
    }

    if (sourcifyRpc.traceSupport) {
      traceSupportedRPCs.push({
        type: sourcifyRpc.traceSupport,
        index,
      });
    }

    if (sourcifyRpc.type === "BaseRPC") {
      rpc.push(sourcifyRpc.url);
      rpcWithoutApiKeys.push(sourcifyRpc.url);
      return;
    }
    // Fill in the api keys
    else if (sourcifyRpc.type === "APIKeyRPC") {
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
      let url = sourcifyRpc.url.replace("{API_KEY}", apiKey);

      const subDomain = process.env[sourcifyRpc.subDomainEnvName || ""];
      if (subDomain) {
        // subDomain is optional
        url = url.replace("{SUBDOMAIN}", subDomain);
      }
      rpc.push(url);
      rpcWithoutApiKeys.push(sourcifyRpc.url);
      return;
    } else if (sourcifyRpc.type === "FetchRequest") {
      rpc.push(sourcifyRpc);
      rpcWithoutApiKeys.push(sourcifyRpc.url);
      return;
    }
    throw new Error(`Invalid rpc type: ${JSON.stringify(sourcifyRpc)}`);
  });
  return {
    rpc,
    rpcWithoutApiKeys,
    traceSupportedRPCs:
      traceSupportedRPCs.length > 0 ? traceSupportedRPCs : undefined,
  };
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

    let rpc: (string | FetchRequestRPCWithHeaderEnvName)[] = [];
    let rpcWithoutApiKeys: string[] = [];
    let traceSupportedRPCs: TraceSupportedRPC[] | undefined = undefined;
    if (sourcifyExtension.rpc) {
      ({ rpc, rpcWithoutApiKeys, traceSupportedRPCs } = buildCustomRpcs(
        sourcifyExtension.rpc,
      ));
    }
    // Fallback to rpcs of chains.json
    if (!rpc.length) {
      ({ rpc, rpcWithoutApiKeys, traceSupportedRPCs } = buildCustomRpcs(
        chain.rpc,
      ));
    }

    // Replace headerEnvName with headerValue in rpc
    sourcifyExtension.rpc?.forEach((rpc) => {
      if (typeof rpc === "object" && "headers" in rpc) {
        rpc.headers?.forEach((header) => {
          if (header.headerEnvName) {
            header.headerValue = process.env[header.headerEnvName] || "";
            delete header.headerEnvName;
          }
        });
      }
    });

    // sourcifyExtension is spread later to overwrite chains.json values, rpc specifically
    const sourcifyChain = new SourcifyChain({
      ...chain,
      ...sourcifyExtension,
      rpc: rpc as FetchRequestRPC[],
      rpcWithoutApiKeys,
      traceSupportedRPCs,
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
      const { rpc, rpcWithoutApiKeys, traceSupportedRPCs } = buildCustomRpcs(
        chain.rpc,
      );
      sourcifyChainsMap[chainId] = new SourcifyChain({
        name: chain.sourcifyName,
        chainId: parseInt(chainId),
        supported: chain.supported,
        rpc: rpc as FetchRequestRPC[],
        fetchContractCreationTxUsing: chain.fetchContractCreationTxUsing,
        rpcWithoutApiKeys,
        traceSupportedRPCs,
      });
    });
  }
}

export { sourcifyChainsMap };
