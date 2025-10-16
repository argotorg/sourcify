import {
  CompilationLanguage,
  VerificationExport,
  VyperSettings,
} from "@ethereum-sourcify/lib-sourcify";
import logger from "../../../common/logger";
import { WStorageService } from "../StorageService";
import { WStorageIdentifiers } from "./identifiers";
import { Database } from "../utils/Database";
import { SourcifyDatabaseService } from "./SourcifyDatabaseService";
import { ExternalVerification } from "../utils/database-util";

export type EtherscanVerifyApiIdentifiers =
  | WStorageIdentifiers.EtherscanVerify
  | WStorageIdentifiers.BlockscoutVerify
  | WStorageIdentifiers.RoutescanVerify;

const DEFAULT_ETHERSCAN_CHAINLIST_ENDPOINT =
  "https://api.etherscan.io/v2/chainlist";
const DEFAULT_BLOCKSCOUT_CHAINLIST_ENDPOINT =
  "https://chains.blockscout.com/api/chains";
const ROUTESCAN_CHAINLIST_ENDPOINTS = [
  {
    workspace: "mainnet",
    endpoint: "https://api.routescan.io/v2/network/mainnet/evm/all/blockchains",
  },
  {
    workspace: "testnet",
    endpoint: "https://api.routescan.io/v2/network/testnet/evm/all/blockchains",
  },
] as const;

type ChainApiUrls = Record<string, string>;

interface EtherscanChainApiResult {
  result?: {
    chainid?: string;
    apiurl?: string;
    status?: number;
  }[];
}

const fetchEtherscanChainApiUrls = async (): Promise<ChainApiUrls> => {
  const targetEndpoint = DEFAULT_ETHERSCAN_CHAINLIST_ENDPOINT;
  let response: Response;

  try {
    response = await fetch(targetEndpoint);
  } catch (error) {
    logger.error("Failed to fetch Etherscan chain list", {
      endpoint: targetEndpoint,
      error,
    });
    throw new Error(
      `Failed to fetch Etherscan chain list from ${targetEndpoint}`,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    logger.error("Etherscan chain list returned non-OK response", {
      endpoint: targetEndpoint,
      status: response.status,
      body,
    });
    throw new Error(
      `Failed to load Etherscan chain list (${response.status}): ${body}`,
    );
  }

  const payload = (await response.json()) as EtherscanChainApiResult;

  if (!Array.isArray(payload.result)) {
    throw new Error("Invalid Etherscan chain list payload");
  }

  const apiUrls: Record<string, string> = {};

  for (const entry of payload.result) {
    if (!entry || entry.status !== 1) continue;
    if (!entry.chainid || !entry.apiurl) continue;

    try {
      const parsedUrl = new URL(entry.apiurl);
      parsedUrl.hash = "";
      apiUrls[entry.chainid] = parsedUrl.toString();
    } catch (error) {
      logger.warn("Skipping invalid Etherscan API URL", {
        entry,
        error,
      });
    }
  }

  if (Object.keys(apiUrls).length === 0) {
    throw new Error(
      "Etherscan chain list did not contain any usable endpoints",
    );
  }

  return apiUrls;
};

interface BlockscoutChainApiResult {
  [chainId: string]: {
    explorers?: { url?: string; hostedBy?: string }[];
  };
}

const fetchBlockscoutChainApiUrls = async (): Promise<ChainApiUrls> => {
  let response: Response;
  const endpoint = DEFAULT_BLOCKSCOUT_CHAINLIST_ENDPOINT;
  try {
    response = await fetch(endpoint);
  } catch (error) {
    logger.error("Failed to fetch Blockscout chain list", {
      endpoint,
      error,
    });
    throw new Error(`Failed to fetch Blockscout chain list from ${endpoint}`);
  }
  if (!response.ok) {
    const body = await response.text();
    logger.error("Blockscout chain list returned non-OK response", {
      endpoint,
      status: response.status,
      body,
    });
    throw new Error(
      `Failed to load Blockscout chain list (${response.status}): ${body}`,
    );
  }
  const payload = (await response.json()) as BlockscoutChainApiResult;
  const apiUrls: Record<string, string> = {};
  for (const [chainId, chainData] of Object.entries(payload)) {
    const explorers = chainData?.explorers;
    if (!Array.isArray(explorers)) continue;
    const blockscoutExplorer = explorers.find(
      (explorer) => explorer?.hostedBy === "blockscout" && explorer.url,
    );
    if (!blockscoutExplorer?.url) continue;
    try {
      const explorerUrl = new URL(blockscoutExplorer.url);
      explorerUrl.pathname = explorerUrl.pathname.replace(/\/$/, "") + "/api";
      explorerUrl.search = "";
      explorerUrl.hash = "";
      apiUrls[chainId] = explorerUrl.toString();
    } catch (error) {
      logger.warn("Skipping invalid Blockscout explorer URL", {
        chainId,
        explorer: blockscoutExplorer,
        error,
      });
    }
  }
  if (Object.keys(apiUrls).length === 0) {
    throw new Error(
      "Blockscout chain list did not contain any usable endpoints",
    );
  }
  return apiUrls;
};

interface RoutescanChainApiResult {
  items: {
    chainId: string | number;
    evmChainId: string | number;
  }[];
}

const fetchRoutescanChainApiUrls = async (): Promise<ChainApiUrls> => {
  const apiUrls: ChainApiUrls = {};

  for (const { workspace, endpoint } of ROUTESCAN_CHAINLIST_ENDPOINTS) {
    let response: Response;

    try {
      response = await fetch(endpoint);
    } catch (error) {
      logger.error("Failed to fetch Routescan chain list", {
        workspace,
        endpoint,
        error,
      });
      throw new Error(
        `Failed to fetch Routescan chain list for ${workspace} from ${endpoint}`,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      logger.error("Routescan chain list returned non-OK response", {
        workspace,
        endpoint,
        status: response.status,
        body,
      });
      throw new Error(
        `Failed to load Routescan chain list for ${workspace} (${response.status}): ${body}`,
      );
    }

    const payload = (await response.json()) as RoutescanChainApiResult;

    if (!Array.isArray(payload.items)) {
      throw new Error(
        `Invalid Routescan chain list payload for workspace ${workspace}`,
      );
    }

    for (const entry of payload.items) {
      if (entry == null) continue;

      const { chainId, evmChainId } = entry;

      if (
        chainId === undefined ||
        chainId === null ||
        evmChainId === undefined ||
        evmChainId === null
      ) {
        logger.warn("Skipping Routescan entry missing required fields", {
          workspace,
          entry,
        });
        continue;
      }

      try {
        const url = new URL("https://api.routescan.io/");
        url.pathname = `/v2/network/${encodeURIComponent(
          workspace,
        )}/evm/${encodeURIComponent(String(chainId))}/etherscan/api`;
        url.search = "";
        url.hash = "";

        apiUrls[String(evmChainId)] = url.toString();
      } catch (error) {
        logger.warn("Skipping invalid Routescan API URL", {
          workspace,
          entry,
          error,
        });
      }
    }
  }

  if (Object.keys(apiUrls).length === 0) {
    throw new Error(
      "Routescan chain list did not contain any usable endpoints",
    );
  }

  return apiUrls;
};

interface EtherscanRpcResponse {
  status: "0" | "1";
  message: string;
  result: string;
}

export interface EtherscanVerifyApiServiceOptions {
  /** Mapping of chainId to the explorer API base URL */
  chainApiUrls?: ChainApiUrls;
  /** Optional mapping of chainId to API keys */
  apiKeys?: Record<string, string>;
  /** Optional fallback API key when chain-specific key is missing */
  defaultApiKey?: string;
}

export class EtherscanVerifyApiService implements WStorageService {
  IDENTIFIER: EtherscanVerifyApiIdentifiers;
  private database: Database;

  private readonly options: Required<EtherscanVerifyApiServiceOptions>;

  constructor(
    identifier: EtherscanVerifyApiIdentifiers,
    sourcifyDatabaseService: SourcifyDatabaseService,
    options?: EtherscanVerifyApiServiceOptions,
  ) {
    this.IDENTIFIER = identifier;
    this.database = sourcifyDatabaseService.database;
    this.options = {
      chainApiUrls: options?.chainApiUrls || {},
      apiKeys: options?.apiKeys || {},
      defaultApiKey: options?.defaultApiKey || "",
    };
  }

  async init(): Promise<boolean> {
    if (Object.keys(this.options.chainApiUrls).length === 0) {
      switch (this.IDENTIFIER) {
        case WStorageIdentifiers.EtherscanVerify:
          this.options.chainApiUrls = await fetchEtherscanChainApiUrls();
          break;
        case WStorageIdentifiers.BlockscoutVerify:
          this.options.chainApiUrls = await fetchBlockscoutChainApiUrls();
          break;
        case WStorageIdentifiers.RoutescanVerify:
          this.options.chainApiUrls = await fetchRoutescanChainApiUrls();
          break;
        default:
          throw new Error(`Unsupported verifier: ${this.IDENTIFIER}`);
      }
    }
    return true;
  }

  async storeVerification(
    verification: VerificationExport,
    jobData?: {
      verificationId: string;
      finishTime: Date;
    },
  ): Promise<void> {
    if (
      verification.compilation.language === "Vyper" &&
      (this.IDENTIFIER === WStorageIdentifiers.RoutescanVerify ||
        this.IDENTIFIER === WStorageIdentifiers.BlockscoutVerify)
    ) {
      logger.info(
        `${this.IDENTIFIER} does not support Etherscan API Vyper contract verification`,
        {
          chainId: verification.chainId,
          address: verification.address,
        },
      );
      throw new Error(
        `${this.IDENTIFIER} does not support Etherscan API Vyper contract verification`,
      );
    }

    const submissionContext = {
      identifier: this.IDENTIFIER,
      chainId: verification.chainId,
      address: verification.address,
    };

    const apiBaseUrl = this.getApiBaseUrl(verification.chainId);
    if (!apiBaseUrl) {
      logger.debug(
        "No Etherscan API endpoint configured for chain",
        submissionContext,
      );
      return;
    }

    let response: EtherscanRpcResponse;
    try {
      response = await this.submitVerification(verification, apiBaseUrl);
    } catch (error) {
      logger.error("Failed to submit verification to explorer", {
        ...submissionContext,
        error,
        apiBaseUrl,
      });
      throw error;
    }

    logger.info("Submitted verification to explorer", {
      ...submissionContext,
      receiptId: response.result,
    });

    if (!jobData?.verificationId) {
      return;
    }

    // Record the result of the failed submission by storing the error message
    if (response.status !== "1" || response.message !== "OK") {
      logger.warn("Explorer rejected verification submission", {
        ...submissionContext,
        verificationJobId: jobData.verificationId,
        error: response.result,
      });
      this.storeExternalVerificationResult(jobData, {
        error: response.result,
      });
      return;
    }

    // Record the result of the successful submission
    this.storeExternalVerificationResult(jobData, {
      verificationId: response.result,
    });
  }

  private async storeExternalVerificationResult(
    jobData: {
      verificationId: string;
      finishTime: Date;
    },
    response: ExternalVerification,
  ): Promise<void> {
    // Record the result of the successful submission
    try {
      await this.database.upsertExternalVerification(
        jobData.verificationId,
        this.IDENTIFIER,
        response,
      );
    } catch (error) {
      logger.error("Failed to record external verification receipt", {
        verificationJobId: jobData.verificationId,
        error,
      });
    }
  }

  private async submitVerification(
    verification: VerificationExport,
    apiBaseUrl: string,
  ): Promise<EtherscanRpcResponse> {
    const url = this.buildApiUrl(
      apiBaseUrl,
      "verifysourcecode",
      verification.chainId,
    );
    const body = this.buildVerificationPayload(verification);

    const response = await fetch(url, {
      method: "POST",
      body,
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `Explorer verification request failed (${response.status}): ${responseText}`,
      );
    }

    return (await response.json()) as EtherscanRpcResponse;
  }

  private buildVerificationPayload(verification: VerificationExport): FormData {
    const formData = new FormData();
    formData.append(
      "codeformat",
      this.getCodeFormat(verification.compilation.language),
    );
    formData.append("sourceCode", this.buildStandardJsonInput(verification));
    formData.append("contractaddress", verification.address);
    formData.append("contractname", this.buildContractName(verification));
    formData.append("compilerversion", this.getCompilerVersion(verification));

    const constructorArgs = this.getConstructorArguments(verification);
    formData.append("constructorArguements", constructorArgs || "");

    if (verification.compilation.language === "Vyper") {
      const vyperOptimization = this.getVyperOptimizationFlag(verification);
      formData.append("optimizationUsed", vyperOptimization ? "1" : "0");
    }

    return formData;
  }

  private buildStandardJsonInput(verification: VerificationExport): string {
    const sources: Record<string, { content: string }> = {};
    for (const [path, content] of Object.entries(
      verification.compilation.sources,
    )) {
      sources[path] = { content };
    }

    const jsonInput = {
      language: verification.compilation.language,
      sources,
      settings: verification.compilation.jsonInput.settings || {},
    };

    return JSON.stringify(jsonInput);
  }

  private buildContractName(verification: VerificationExport): string {
    const target = verification.compilation.compilationTarget;

    if (target?.path && target?.name) {
      return `${target.path}:${target.name}`;
    }

    if (target?.name) {
      return target.name;
    }

    return "Contract";
  }

  private getCompilerVersion(verification: VerificationExport): string {
    const version = verification.compilation.compilerVersion;

    if (verification.compilation.language === "Vyper") {
      return `vyper:${version.split("+")[0]}`;
    }
    return version.startsWith("v") ? version : `v${version}`;
  }

  private getConstructorArguments(
    verification: VerificationExport,
  ): string | null {
    const constructorArgs =
      verification.transformations?.creation?.values?.constructorArguments;
    if (!constructorArgs) {
      return null;
    }
    return constructorArgs.replace(/^0x/i, "");
  }

  private buildApiUrl(
    apiBaseUrl: string,
    action: string,
    chainId: number,
  ): string {
    const url = new URL(apiBaseUrl);

    url.searchParams.set("module", "contract");
    url.searchParams.set("action", action);
    url.searchParams.set("chainid", String(chainId));

    const apiKey = this.getApiKey(chainId);
    if (apiKey) {
      url.searchParams.set("apikey", apiKey);
    }

    return url.toString();
  }

  private getApiBaseUrl(chainId: number): string | undefined {
    const key = String(chainId);
    return this.options.chainApiUrls[key];
  }

  private getApiKey(chainId: number): string | undefined {
    const key = String(chainId);
    const specificKey = this.options.apiKeys[key];
    if (specificKey) {
      return specificKey;
    }
    if (this.options.defaultApiKey) {
      return this.options.defaultApiKey;
    }
    return undefined;
  }

  private getCodeFormat(language: CompilationLanguage): string {
    if (language === "Vyper") {
      return "vyper-standard-json-input";
    }
    return "solidity-standard-json-input";
  }

  private getVyperOptimizationFlag(verification: VerificationExport): boolean {
    if (verification.compilation.language !== "Vyper") {
      return false;
    }

    const settings = verification.compilation.jsonInput
      .settings as VyperSettings;

    const optimize = settings?.optimize;

    if (typeof optimize === "string") {
      return optimize === "none" ? false : true;
    }

    if (typeof optimize === "boolean") {
      return optimize;
    }

    return false;
  }
}
