import type { TraceSupport } from "@ethereum-sourcify/lib-sourcify";
import type DecentralizedStorageFetcher from "./DecentralizedStorageFetcher";

export type KnownDecentralizedStorageFetchers = {
  [type in DecentralizedStorageOrigin]?: DecentralizedStorageFetcher;
};

export type DecentralizedStorageOrigin = "ipfs" | "bzzr1" | "bzzr0";

type DecentralizedStorageTypes = "ipfs" | "swarm";

export type GatewayFetcherConfig = {
  url: string;
  timeout: number;
  interval: number;
  retries: number;
  headers?: HeadersInit;
};

export type DecentralizedStorageConfig = Partial<GatewayFetcherConfig> & {
  enabled: boolean;
  gateways: Array<string | Partial<GatewayFetcherConfig>>;
};

export type DecentralizedStorageConfigMap = {
  [K in DecentralizedStorageTypes]?: DecentralizedStorageConfig;
};

export type ChainMonitorConfig = {
  startBlock?: number;
  blockInterval?: number;
  blockIntervalFactor?: number;
  blockIntervalUpperLimit?: number;
  blockIntervalLowerLimit?: number;
  bytecodeInterval?: number;
  bytecodeNumberOfTries?: number;
};

export type DefatultChainMonitorConfig = {
  startBlock: undefined; // Default to latest block
  blockInterval: number;
  blockIntervalFactor: number;
  blockIntervalUpperLimit: number;
  blockIntervalLowerLimit: number;
  bytecodeInterval: number;
  bytecodeNumberOfTries: number;
};

export type SourcifyRequestOptions = {
  maxRetries: number;
  retryDelay: number;
};

export type MonitorConfig = {
  decentralizedStorages: DecentralizedStorageConfigMap;
  sourcifyServerURLs: string[];
  sourcifyRequestOptions: SourcifyRequestOptions;
  defaultChainConfig: DefatultChainMonitorConfig;
  similarityVerification: SimilarityVerificationConfig;
  chainConfigs?: {
    [chainId: number]: ChainMonitorConfig;
  };
};

export interface SimilarityVerificationConfig {
  requestDelay?: number;
}

export type PassedMonitorConfig = {
  decentralizedStorages?: DecentralizedStorageConfigMap;
  sourcifyServerURLs?: string[];
  sourcifyRequestOptions?: Partial<SourcifyRequestOptions>;
  defaultChainConfig?: DefatultChainMonitorConfig;
  similarityVerification?: SimilarityVerificationConfig;
  chainConfigs?: {
    [chainId: number]: ChainMonitorConfig;
  };
};

export type RpcObject = {
  type: "ApiKey";
  url: string;
  apiKeyEnvName: string;
  subDomainEnvName?: string;
  traceSupport?: TraceSupport;
};

export type MonitorChain = {
  name: string;
  title?: string;
  chainId: number;
  rpc: Array<string | RpcObject>;
};
