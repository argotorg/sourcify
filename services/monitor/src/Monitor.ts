import DecentralizedStorageFetcher from "./DecentralizedStorageFetcher";
import assert from "assert";
import { EventEmitter } from "stream";
import type {
  FetchRequestRPC,
  SourcifyRpc,
} from "@ethereum-sourcify/lib-sourcify";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import logger from "./logger";
import "./loggerServer"; // Start the dynamic log level server
import ChainMonitor from "./ChainMonitor";
import type {
  KnownDecentralizedStorageFetchers,
  MonitorChain,
  MonitorConfig,
  PassedMonitorConfig,
} from "./types";
import dotenv from "dotenv";
import defaultConfig from "./defaultConfig";
import path from "path";
import SimilarityVerificationClient from "./SimilarityVerificationClient";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

export default class Monitor extends EventEmitter {
  private chainMonitors: ChainMonitor[];
  private sourceFetchers: KnownDecentralizedStorageFetchers = {};
  private config: MonitorConfig;
  private similarityVerificationClient: SimilarityVerificationClient;

  constructor(
    chainsToMonitor: MonitorChain[],
    passedConfig?: PassedMonitorConfig,
  ) {
    super();

    logger.info("Passed config", passedConfig);

    if (!passedConfig || Object.keys(passedConfig).length === 0) {
      logger.warn("No config provided, using default config");
    }

    this.config = deepMerge(defaultConfig, passedConfig || {});

    const monitorFactoriesEnv = process.env["MONITOR_FACTORIES"];
    if (monitorFactoriesEnv !== undefined) {
      const monitorFactories =
        monitorFactoriesEnv.toLowerCase() === "true" ? true : false;
      this.config.monitorFactories = monitorFactories;
    }
    logger.info(
      `Monitoring factories is ${this.config.monitorFactories ? "enabled" : "disabled"}`,
      {
        monitorFactories: this.config.monitorFactories,
      },
    );

    if (this.config.decentralizedStorages?.ipfs?.enabled) {
      assert(
        this.config.decentralizedStorages.ipfs.gateways.length > 0,
        "IPFS gateways must be provided",
      );
      this.sourceFetchers.ipfs = new DecentralizedStorageFetcher(
        "ipfs",
        this.config.decentralizedStorages.ipfs,
      );
    }

    const similarityBaseUrls = this.config.sourcifyServerURLs
      .map((url) => url.replace(/\/+$/, ""))
      .filter(Boolean);
    this.similarityVerificationClient = new SimilarityVerificationClient(
      similarityBaseUrls,
      this.config.similarityVerification,
    );

    const sourcifyChains = chainsToMonitor.map((chain) => {
      if (chain instanceof SourcifyChain) {
        return chain;
      } else {
        return new SourcifyChain({
          chainId: chain.chainId,
          rpcs: authenticateRpcs(chain),
          name: chain.name,
          supported: true,
        });
      }
    });

    logger.info("Creating ChainMonitors", {
      numberOfChains: sourcifyChains.length,
      chains: sourcifyChains.map((c) => c.chainId),
    });

    if (sourcifyChains.length === 0) {
      throw new Error("No chains to monitor");
    }

    // Convert the chainId values to strings for comparison with object keys
    const chainIdSet = new Set(
      chainsToMonitor.map((item) => item.chainId.toString()),
    );

    const chainsInConfigButNotChainsToMonitor: string[] = [];

    // Check if there's a chain config for a chain that's not being monitored
    for (const key in this.config.chainConfigs) {
      if (!chainIdSet.has(key)) {
        chainsInConfigButNotChainsToMonitor.push(key);
      }
    }

    if (
      chainsInConfigButNotChainsToMonitor.length > 0 &&
      process.env.NODE_ENV === "production"
    ) {
      throw new Error(
        `Chain configs found for chains that are not being monitored: ${chainsInConfigButNotChainsToMonitor.join(
          ",",
        )}`,
      );
    }

    this.chainMonitors = sourcifyChains.map(
      (chain) =>
        new ChainMonitor(
          chain,
          this.sourceFetchers,
          this.config,
          this.similarityVerificationClient,
        ),
    );
  }

  /**
   * Starts the monitor on all the designated chains.
   */
  start = async (): Promise<void> => {
    logger.info("Starting Monitor for chains", {
      numberOfChains: this.chainMonitors.length,
      chains: this.chainMonitors.map((cm) => cm.sourcifyChain.chainId),
    });
    const promises: Promise<void>[] = [];
    for (const cm of this.chainMonitors) {
      promises.push(cm.start());
    }
    await Promise.all(promises);
    logger.info("All ChainMonitors started");
  };

  /**
   * Stops the monitor after executing all the pending requests.
   */
  stop = (): void => {
    this.chainMonitors.forEach((cm) => cm.stop());
    logger.info("Monitor stopped");
  };
}

export function authenticateRpcs(chain: MonitorChain): SourcifyRpc[] {
  return chain.rpc.map((rpc) => {
    if (typeof rpc === "string") {
      if (rpc?.includes("ethpandaops.io")) {
        const fetchRequestRpc: FetchRequestRPC = {
          type: "FetchRequest",
          url: rpc,
          headers: [
            {
              headerName: "CF-Access-Client-Id",
              headerValue: process.env["CF_ACCESS_CLIENT_ID"] || "",
            },
            {
              headerName: "CF-Access-Client-Secret",
              headerValue: process.env["CF_ACCESS_CLIENT_SECRET"] || "",
            },
          ],
        };
        return { rpc: fetchRequestRpc };
      }
      return { rpc };
    }
    if (rpc?.type === "ApiKey") {
      const apiKey = process.env[rpc.apiKeyEnvName] || "";
      if (!apiKey) {
        throw new Error(
          `API key ${rpc.apiKeyEnvName} not found in environment variables`,
        );
      }
      let secretUrl = rpc.url.replace("{API_KEY}", apiKey);
      if (rpc?.subDomainEnvName) {
        // subDomain is optional
        const subDomain = process.env[rpc.subDomainEnvName];
        if (!subDomain) {
          throw new Error(
            `Subdomain ${rpc.subDomainEnvName} not found in environment variables`,
          );
        }
        secretUrl = secretUrl.replace("{SUBDOMAIN}", subDomain);
      }
      return {
        rpc: secretUrl,
        ...(rpc.traceSupport ? { traceSupport: rpc.traceSupport } : {}),
      };
    }
    throw new Error("Invalid rpc object: " + JSON.stringify(rpc));
  });
}

function deepMerge(obj1: any, obj2: any): any {
  const output = { ...obj1 };
  for (const [key, value] of Object.entries(obj2)) {
    if (value === Object(value) && !Array.isArray(value)) {
      if (Object.prototype.hasOwnProperty.call(obj1, key)) {
        output[key] = deepMerge(obj1[key], value);
      } else {
        output[key] = value;
      }
    } else {
      output[key] = value;
    }
  }
  return output;
}
