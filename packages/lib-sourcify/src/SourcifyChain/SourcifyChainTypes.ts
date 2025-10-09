/* Type for the sourcify-chains.json configuration file */
export interface SourcifyChainsExtensionsObject {
  [chainId: string]: SourcifyChainExtension;
}

export type SourcifyChainExtension = {
  sourcifyName: string; // Keep it required to not forget name in sourcify-chains.json
  supported: boolean;
  etherscanApi?: {
    supported: boolean;
    apiKeyEnvName?: string;
  };
  fetchContractCreationTxUsing?: FetchContractCreationTxMethods;
  rpc?: Array<string | BaseRPC | APIKeyRPC | FetchRequestRPC>;
};

export interface FetchContractCreationTxMethods {
  blockscoutApi?: {
    url: string;
  };
  blockscoutScrape?: {
    url: string;
    blockscoutPrefix?: string;
  };
  routescanApi?: {
    type: 'mainnet' | 'testnet';
  };
  etherscanApi?: boolean;
  etherscanScrape?: {
    url: string;
  };
  blocksScanApi?: {
    url: string;
  };
  meterApi?: {
    url: string;
  };
  telosApi?: {
    url: string;
  };
  avalancheApi?: boolean;
  nexusApi?: {
    url: string;
    runtime: string;
  };
  veChainApi?: boolean;
}

// types of the keys of FetchContractCreationTxMethods
export type FetchContractCreationTxMethod =
  keyof FetchContractCreationTxMethods;

export type TraceSupport = 'trace_transaction' | 'debug_traceTransaction';

export type BaseRPC = {
  url: string;
  type: 'BaseRPC';
  traceSupport?: TraceSupport;
};

// override the type of BaseRPC to add the type field
export type APIKeyRPC = Omit<BaseRPC, 'type'> & {
  type: 'APIKeyRPC';
  apiKeyEnvName: string;
  subDomainEnvName?: string;
};

// override the type of BaseRPC to add the type field
export type FetchRequestRPC = Omit<BaseRPC, 'type'> & {
  type: 'FetchRequest';
  headers?: Array<{
    headerName: string;
    headerValue: string;
  }>;
};

// Need to define the rpc property explicitly as when a sourcifyChain is created with {...chain, sourcifyChainExtension}, Typescript throws with "Type '(string | FetchRequest)[]' is not assignable to type 'string[]'." For some reason the Chain.rpc is not getting overwritten by SourcifyChainExtension.rpc
// Also omit the 'sourcifyName' as it is only needed to have the name in sourcify-chains.json but not when instantiating a SourcifyChain
export type SourcifyChainInstance = Omit<Chain, 'rpc'> &
  Omit<SourcifyChainExtension, 'rpc' | 'sourcifyName'> & {
    rpcs: SourcifyRpc[];
  };

/**
 * Unified RPC configuration that combines URL, credentials, trace support, and display variants
 */
export interface SourcifyRpc {
  /** The actual RPC URL or FetchRequest config used to create the provider */
  rpc: string | FetchRequestRPC;

  /** URL without API keys for public display (e.g., in /chains API response) */
  urlWithoutApiKey?: string;

  /** URL with masked API key for safe logging (e.g., "https://eth-mainnet.g.alchemy.com/v2/****xyz") */
  maskedUrl?: string;

  /** Optional trace support type if this RPC supports trace/debug methods */
  traceSupport?: TraceSupport;

  /** RPC health tracking for circuit breaker pattern */
  health?: {
    /** Number of consecutive failures */
    consecutiveFailures: number;
    /** Timestamp when this RPC can be retried in milliseconds */
    nextRetryTime?: number;
  };
}

export type TraceSupportedRPC = {
  type: TraceSupport;
  index: number;
};

export type Chain = {
  name: string;
  title?: string;
  chainId: number;
  shortName?: string;
  network?: string;
  networkId?: number;
  nativeCurrency?: Currency;
  rpc: Array<string>;
  faucets?: string[];
  infoURL?: string;
};

type Currency = {
  name: string;
  symbol: string;
  decimals: number;
};

// https://geth.ethereum.org/docs/developers/evm-tracing/built-in-tracers#call-tracer
export interface CallFrame {
  type: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasUsed: string;
  input: string;
  output: string;
  error: string;
  revertReason: string;
  calls: CallFrame[];
}
