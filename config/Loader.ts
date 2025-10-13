import defaultConfig from "./Config";
import { SourcifyChainInstance } from "@ethereum-sourcify/lib-sourcify";
import { Options } from "sequelize";
import {
  FetchContractCreationTxMethods,
  FetchRequestRPC,
} from "@ethereum-sourcify/lib-sourcify/build/main/SourcifyChain/SourcifyChainTypes";
import { Conflux } from "js-conflux-sdk";

export interface Config {
  server: ServerOptions;
  proxy: string;
  chains: { [chainId: number]: ChainInstance };
  solc: SolcOptions;
  vyper: VyperOptions;
  mysql: DatabaseOptions;
}

export type ChainInstance = SourcifyChainInstance & {
  rpc: Array<string | FetchRequestRPC | Conflux.ConfluxOption>;
  corespace?: boolean;
  confluxscanApi?: {
    apiURL: string;
    apiKeyEnvName?: string;
  };
  fetchContractCreationTxUsing?: FetchContractCreationTxUsing;
};

export interface FetchContractCreationTxUsing
  extends FetchContractCreationTxMethods {
  confluxscanApi?: boolean;
  confluxscanScrape?: {
    url: string;
  };
}

export function isConfluxOption(obj: any): obj is Conflux.ConfluxOption {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const opt = obj as Conflux.ConfluxOption;

  const hasDefaultGasPrice =
    !("defaultGasPrice" in opt) ||
    typeof opt.defaultGasPrice === "string" ||
    typeof opt.defaultGasPrice === "number";
  const hasUrl = !("url" in opt) || typeof opt.url === "string";
  const hasRetry = !("retry" in opt) || typeof opt.retry === "number";
  const hasTimeout = !("timeout" in opt) || typeof opt.timeout === "number";
  const hasNetworkId =
    !("networkId" in opt) || typeof opt.networkId === "number";
  const hasUseWechatProvider =
    !("useWechatProvider" in opt) || typeof opt.useWechatProvider === "boolean";
  const hasUseHexAddressInParameter =
    !("useHexAddressInParameter" in opt) ||
    typeof opt.useHexAddressInParameter === "boolean";
  const hasUseVerboseAddress =
    !("useVerboseAddress" in opt) || typeof opt.useVerboseAddress === "boolean";

  return (
    hasDefaultGasPrice &&
    hasUrl &&
    hasRetry &&
    hasTimeout &&
    hasNetworkId &&
    hasUseWechatProvider &&
    hasUseHexAddressInParameter &&
    hasUseVerboseAddress
  );
}

export interface ServerOptions {
  port: number;
  maxFileSize: number;
  enableProfile: boolean;
}

export interface SolcOptions {
  solcBinRepo: string;
  solcJsRepo: string;
}

export interface VyperOptions {
  vyperRepo: string;
}

export interface DatabaseOptions extends Options {
  syncSchema: boolean;
  readonly: boolean;
}

export function loadConfig(): Config {
  const config = (defaultConfig as any) as Config;

  for (const [chainId, chain] of Object.entries(config.chains)) {
    if (!chain.chainId) {
      chain.chainId = parseInt(chainId);
    }
  }

  return config;
}
