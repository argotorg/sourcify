import * as fs from 'node:fs';
import defaultConfig from "./Config";
import { SourcifyChainInstance } from "@ethereum-sourcify/lib-sourcify";
import { Options } from "sequelize";
import {
    FetchRequestRPC,
} from "@ethereum-sourcify/lib-sourcify/build/main/SourcifyChain/SourcifyChainTypes";
import { Conflux } from "js-conflux-sdk";

export interface Config {
    server: ServerOptions
    chains: {[chainId: number]: ChainInstance}
    solc: SolcOptions
    mysql: DatabaseOptions
}

export type ChainInstance = SourcifyChainInstance & {
    rpc: Array<string | FetchRequestRPC | Conflux.ConfluxOption>;
    confluxSupported?: boolean
}

export function isConfluxOption(obj: any): obj is Conflux.ConfluxOption {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }

    const opt = obj as Conflux.ConfluxOption;

    const hasDefaultGasPrice = !('defaultGasPrice' in obj)
      || typeof obj.defaultGasPrice === 'string'
      || typeof obj.defaultGasPrice === 'number'
    const hasUrl = !('url' in obj)
      || typeof obj.url === 'string'
    const hasRetry = !('retry' in obj)
      || typeof obj.retry === 'number'
    const hasTimeout = !('timeout' in obj)
      || typeof obj.timeout === 'number'
    const hasNetworkId = !('networkId' in obj)
      || typeof obj.networkId === 'number'
    const hasUseWechatProvider = !('useWechatProvider' in obj)
      || typeof obj.useWechatProvider === 'boolean'
    const hasUseHexAddressInParameter = !('useHexAddressInParameter' in obj)
      || typeof obj.useHexAddressInParameter === 'boolean'
    const hasUseVerboseAddress = !('useVerboseAddress' in obj)
      || typeof obj.useVerboseAddress === 'boolean'

    return hasDefaultGasPrice && hasUrl && hasRetry
      && hasTimeout && hasNetworkId && hasUseWechatProvider
      && hasUseHexAddressInParameter && hasUseVerboseAddress;
}

export interface ServerOptions{
    port: number
    maxFileSize: number
}

export interface SolcOptions{
    solcBinRepo: string
    solcJsRepo: string
}

export interface DatabaseOptions extends Options{
    syncSchema: boolean
    readonly : boolean
}

export function loadConfig(customized = 'Local'): Config {
    if (fs.existsSync(`${__dirname}/${customized}.js`)){
        const customizedConfig = require(`./${customized}`)
        return {...defaultConfig, ...customizedConfig}
    }
    return defaultConfig as Config;
}
