import type {
  CompilationLanguage,
  VerificationExport,
  VyperSettings,
} from "@ethereum-sourcify/lib-sourcify";
import logger from "../../../common/logger";
import type { StorageService, WStorageService } from "../StorageService";
import { WStorageIdentifiers } from "./identifiers";
import type { Database } from "../utils/Database";
import type { SourcifyDatabaseService } from "./SourcifyDatabaseService";
import type { ExternalVerification, Tables } from "../utils/database-util";
import type {
  ApiExternalVerification,
  ApiExternalVerifications,
} from "../../types";

export type EtherscanVerifyApiIdentifiers =
  | WStorageIdentifiers.EtherscanVerify
  | WStorageIdentifiers.BlockscoutVerify
  | WStorageIdentifiers.RoutescanVerify;

const DEFAULT_ETHERSCAN_CHAINLIST_ENDPOINT =
  "https://api.etherscan.io/v2/chainlist";
const DEFAULT_BLOCKSCOUT_CHAINLIST_ENDPOINT =
  "https://chains.blockscout.com/api/chains";
const BLOCKSCOUT_ALREADY_VERIFIED = "BLOCKSCOUT_ALREADY_VERIFIED";
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
const ROUTESCAN_API_URL_TEMPLATE =
  "https://api.routescan.io/v2/network/${WORKSPACE}/evm/${CHAIN_ID}/etherscan/api";

const ROUTESCAN_EXPLORER_URL_TEMPLATE =
  "https://routescan.io/address/${ADDRESS}";

type ChainApiUrls = Record<string, string>;

interface EtherscanChainApiResult {
  result?: {
    chainid?: string;
    apiurl?: string;
    status?: number;
    blockexplorer?: string;
  }[];
}

interface VerifierInformation {
  apiUrls: ChainApiUrls;
  explorerUrls: ChainApiUrls;
}

const fetchEtherscanInformation = async (): Promise<VerifierInformation> => {
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
  const explorerUrls: Record<string, string> = {};

  for (const entry of payload.result) {
    if (!entry || entry.status !== 1) continue;
    if (!entry.chainid || !entry.apiurl || !entry.blockexplorer) continue;

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

    try {
      const parsedUrl = new URL(entry.blockexplorer);
      parsedUrl.hash = "";
      explorerUrls[entry.chainid] =
        `${parsedUrl.toString()}/address/\${ADDRESS}`;
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

  return {
    apiUrls,
    explorerUrls,
  };
};

interface BlockscoutChainApiResult {
  [chainId: string]: {
    explorers?: { url?: string; hostedBy?: string }[];
  };
}

const fetchBlockscoutInformation = async (): Promise<VerifierInformation> => {
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
  const explorerUrls: Record<string, string> = {};
  for (const [chainId, chainData] of Object.entries(payload)) {
    const explorers = chainData?.explorers;
    if (!Array.isArray(explorers)) continue;
    const blockscoutExplorer = explorers.find((explorer) => explorer.url);
    if (!blockscoutExplorer?.url) continue;
    try {
      const explorerUrl = new URL(blockscoutExplorer.url);
      explorerUrl.pathname = explorerUrl.pathname.replace(/\/$/, "") + "/api";
      explorerUrl.search = "";
      explorerUrl.hash = "";
      apiUrls[chainId] = explorerUrl.toString();
      explorerUrls[chainId] = `${blockscoutExplorer.url}/address/\${ADDRESS}`;
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
  return {
    apiUrls,
    explorerUrls,
  };
};

interface RoutescanChainApiResult {
  items: {
    chainId: string | number;
    evmChainId: string | number;
  }[];
}

const fetchRoutescanInformation = async (): Promise<VerifierInformation> => {
  const apiUrls: ChainApiUrls = {};
  const explorerUrls: Record<string, string> = {};

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
        const url = new URL(
          ROUTESCAN_API_URL_TEMPLATE.replace(
            "${WORKSPACE}",
            encodeURIComponent(workspace),
          ).replace("${CHAIN_ID}", encodeURIComponent(String(chainId))),
        );
        url.search = "";
        url.hash = "";

        apiUrls[String(evmChainId)] = url.toString();
        explorerUrls[String(evmChainId)] =
          `${ROUTESCAN_EXPLORER_URL_TEMPLATE}?chainid=${String(chainId)}`;
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

  return {
    apiUrls,
    explorerUrls,
  };
};

interface EtherscanRpcResponse {
  status: "0" | "1";
  message: string;
  result: string;
}

export const buildJobExternalVerificationsObject = (
  storageService: StorageService,
  externalVerification: Tables.VerificationJob["external_verification"],
  chainId: string,
  address: string,
  verificationJobId: string,
): ApiExternalVerifications => {
  if (!externalVerification) {
    return {};
  }
  return Object.keys(externalVerification).reduce((verifiersData, verifier) => {
    const verifierIdentifier = verifier as EtherscanVerifyApiIdentifiers;
    const verifierService = storageService.wServices[
      verifierIdentifier
    ] as EtherscanVerifyApiService | undefined;
    const verifierData = externalVerification[verifierIdentifier];
    if (!verifierData) {
      return verifiersData;
    }

    let statusUrl;
    if (
      verifierData.verificationId &&
      // We need to handle the special case for a blockscout already verified contract
      verifierData.verificationId !== BLOCKSCOUT_ALREADY_VERIFIED
    ) {
      try {
        const apiBaseUrl = verifierService?.getApiUrl(
          "checkverifystatus",
          parseInt(chainId),
        );
        if (apiBaseUrl) {
          statusUrl = `${apiBaseUrl}&guid=${encodeURIComponent(verifierData.verificationId)}`;
        }
      } catch (error) {
        // Cannot generate url
      }
    }

    let explorerUrl;
    if (verifierData.verificationId) {
      try {
        const apiBaseUrl = verifierService?.getExplorerUrl(
          parseInt(chainId),
        );
        if (apiBaseUrl) {
          explorerUrl = apiBaseUrl.replace(
            "${ADDRESS}",
            encodeURIComponent(address),
          );
        }
      } catch (error) {
        // Cannot generate url
      }
    }

    const externalVerifications: ApiExternalVerification = {
      verificationId: verifierData.verificationId,
      error: verifierData.error,
      statusUrl,
      explorerUrl,
    };

    switch (verifier) {
      case WStorageIdentifiers.EtherscanVerify:
        verifiersData.etherscan = externalVerifications;
        break;
      case WStorageIdentifiers.BlockscoutVerify:
        verifiersData.blockscout = externalVerifications;
        break;
      case WStorageIdentifiers.RoutescanVerify:
        verifiersData.routescan = externalVerifications;
        break;
      default:
        logger.warn("Unknown external verifier found", {
          verifier,
          verificationJobId,
        });
        break;
    }
    return verifiersData;
  }, {} as ApiExternalVerifications);
};

export interface EtherscanVerifyApiServiceOptions {
  chainInformation?: {
    /** Mapping of chainId to the explorer API base URL */
    apiUrls?: ChainApiUrls;
    /** Mapping of chainId to the explorer URL */
    explorerUrls?: ChainApiUrls;
  };
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
      chainInformation: options?.chainInformation || {},
      apiKeys: options?.apiKeys || {},
      defaultApiKey: options?.defaultApiKey || "",
    };
  }

  async init(): Promise<boolean> {
    if (
      !this.options.chainInformation ||
      Object.keys(this.options.chainInformation).length === 0
    ) {
      switch (this.IDENTIFIER) {
        case WStorageIdentifiers.EtherscanVerify: {
          const { apiUrls, explorerUrls } = await fetchEtherscanInformation();
          this.options.chainInformation.apiUrls = apiUrls;
          this.options.chainInformation.explorerUrls = explorerUrls;
          break;
        }
        case WStorageIdentifiers.BlockscoutVerify: {
          const { apiUrls, explorerUrls } = await fetchBlockscoutInformation();
          this.options.chainInformation.apiUrls = apiUrls;
          this.options.chainInformation.explorerUrls = explorerUrls;
          break;
        }
        case WStorageIdentifiers.RoutescanVerify: {
          const { apiUrls, explorerUrls } = await fetchRoutescanInformation();
          this.options.chainInformation.apiUrls = apiUrls;
          this.options.chainInformation.explorerUrls = explorerUrls;
          break;
        }
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
      this.IDENTIFIER === WStorageIdentifiers.RoutescanVerify
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

    // Special handling for Blockscout Vyper verification
    // Blockscout uses a different endpoint and payload for Vyper contracts
    if (
      this.IDENTIFIER === WStorageIdentifiers.BlockscoutVerify &&
      verification.compilation.language === "Vyper"
    ) {
      await this.handleBlockscoutVyperVerification(
        verification,
        apiBaseUrl,
        submissionContext,
        jobData,
      );
      return;
    }

    let response: EtherscanRpcResponse;
    try {
      response = await this.submitVerification(verification, apiBaseUrl);
    } catch (error: any) {
      // Store the external verification result if we have job data
      if (jobData) {
        this.storeExternalVerificationResult(jobData, {
          error: error.message,
        });
      }
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

    // If we don't have job data, we cannot store the result
    if (!jobData?.verificationId) {
      return;
    }

    // Handle the "already verified" case for Blockscout by storing
    // { verificationId: "BLOCKSCOUT_ALREADY_VERIFIED" }
    if (
      this.IDENTIFIER === WStorageIdentifiers.BlockscoutVerify &&
      response.result === "Smart-contract already verified."
    ) {
      this.storeExternalVerificationResult(jobData, {
        verificationId: BLOCKSCOUT_ALREADY_VERIFIED,
      });
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

  private async handleBlockscoutVyperVerification(
    verification: VerificationExport,
    apiBaseUrl: string,
    submissionContext: {
      identifier: string;
      chainId: number;
      address: string;
    },
    jobData?: {
      verificationId: string;
      finishTime: Date;
    },
  ): Promise<void> {
    const url = this.buildBlockscoutVyperUrl(apiBaseUrl, verification.address);
    const body = this.buildBlockscoutVyperPayload(verification);

    const response = await fetch(url, {
      method: "POST",
      body,
    });

    // This case handles the Bad Requests cases or server errors
    if (!response.ok) {
      const responseText = await response.text();
      if (jobData) {
        this.storeExternalVerificationResult(jobData, {
          error: responseText,
        });
      }
      logger.warn("Blockscout Vyper verification request failed", {
        status: response.status,
        responseText,
        apiBaseUrl,
      });
      throw new Error(
        `Blockscout Vyper verification request failed (${response.status}): ${responseText}`,
      );
    }
    const res = (await response.json()) as {
      message: string;
    };
    if (jobData) {
      // Blockscout does not return a verification ID,
      // so we use a fixed string to indicate a successful submission
      if (res.message === "Smart-contract verification started") {
        this.storeExternalVerificationResult(jobData, {
          verificationId: "BLOCKSCOUT_VYPER_SUBMITTED",
        });
      } else {
        this.storeExternalVerificationResult(jobData, {
          error: res.message,
        });
      }
    }
    logger.info("Submitted verification to explorer", {
      ...submissionContext,
      receiptId: res.message,
    });
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

  private buildBlockscoutVyperPayload(
    verification: VerificationExport,
  ): FormData {
    const formData = new FormData();
    formData.append(
      "compiler_version",
      `v${verification.compilation.compilerVersion}`,
    );
    formData.append("license_type", "");
    formData.append(
      "evm_version",
      verification.compilation.jsonInput.settings.evmVersion || "default",
    );

    const standardJsonInput = this.buildStandardJsonInput(verification);
    formData.append(
      "files[0]",
      new Blob([standardJsonInput], {
        type: "application/json",
      }),
      "vyper-standard-input.json",
    );

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

  private buildBlockscoutVyperUrl(apiBaseUrl: string, address: string): string {
    const url = new URL(apiBaseUrl);
    const basePath = url.pathname.replace(/\/+$/, "");
    const normalizedAddress = address.toLowerCase();
    const fullPath =
      `${basePath}/v2/smart-contracts/${normalizedAddress}/verification/via/vyper-standard-input`.replace(
        /\/{2,}/g,
        "/",
      );

    url.pathname = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
    url.search = "";
    url.hash = "";

    return url.toString();
  }

  private buildContractName(verification: VerificationExport): string {
    const target = verification.compilation.compilationTarget;
    return `${target.path}:${target.name}`;
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

  public getExplorerUrl(chainId: number): string | undefined {
    const key = String(chainId);
    return this.options.chainInformation?.explorerUrls?.[key];
  }

  public getApiUrl(action: string, chainId: number): string | undefined {
    const apiBaseUrl = this.getApiBaseUrl(chainId);
    if (!apiBaseUrl) {
      return undefined;
    }
    return this.buildApiUrl(apiBaseUrl, action, chainId, false);
  }

  private buildApiUrl(
    apiBaseUrl: string,
    action: string,
    chainId: number,
    includeApiKey = true,
  ): string {
    const url = new URL(apiBaseUrl);

    url.searchParams.set("module", "contract");
    url.searchParams.set("action", action);
    url.searchParams.set("chainid", String(chainId));

    if (includeApiKey) {
      const apiKey = this.getApiKey(chainId);
      if (apiKey) {
        url.searchParams.set("apikey", apiKey);
      }
    }

    return url.toString();
  }

  private getApiBaseUrl(chainId: number): string | undefined {
    const key = String(chainId);
    return this.options.chainInformation?.apiUrls?.[key];
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
