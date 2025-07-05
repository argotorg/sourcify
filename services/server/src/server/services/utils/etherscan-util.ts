import { BadRequestError, NotFoundError } from "../../../common/errors";
import {
  ISolidityCompiler,
  IVyperCompiler,
  SolidityJsonInput,
  SourcifyChain,
  VyperJsonInput,
  VyperCompilation,
  SolidityCompilation,
  Sources,
} from "@ethereum-sourcify/lib-sourcify";
import { TooManyRequests } from "../../../common/errors/TooManyRequests";
import { BadGatewayError } from "../../../common/errors/BadGatewayError";
import logger from "../../../common/logger";
import {
  ChainNotFoundError,
  EtherscanLimitError,
  EtherscanRequestFailedError,
  MalformedEtherscanResponseError,
  NotEtherscanVerifiedError,
} from "../../apiv2/errors";
import SolidityParser from "@solidity-parser/parser";

interface VyperVersion {
  compiler_version: string;
  tag: string;
}

interface VyperVersionCache {
  versions: VyperVersion[];
  lastFetch: number;
}

let vyperVersionCache: VyperVersionCache | null = null;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour default

export const getVyperCompilerVersion = async (
  compilerString: string,
  cacheDurationMs: number = CACHE_DURATION_MS,
): Promise<string | undefined> => {
  const now = Date.now();

  // Check if cache needs refresh
  if (
    !vyperVersionCache ||
    now - vyperVersionCache.lastFetch > cacheDurationMs
  ) {
    try {
      const response = await fetch(
        "https://vyper-releases-mirror.hardhat.org/list.json",
      );
      const versions = await response.json();
      vyperVersionCache = {
        versions: versions.map((version: any) => ({
          compiler_version: version.assets[0]?.name
            .replace("vyper.", "")
            .replace(".darwin", "")
            .replace(".linux", "")
            .replace(".windows.exe", ""),
          tag: version.tag_name.substring(1),
        })),
        lastFetch: now,
      };
    } catch (error) {
      logger.error("Failed to fetch Vyper versions", { error });
      // If cache exists but is stale, use it rather than failing
      if (vyperVersionCache) {
        logger.warn("Using stale Vyper versions cache");
      } else {
        throw error;
      }
    }
  }

  if (!vyperVersionCache) {
    return undefined;
  }

  const versionNumber = compilerString.split(":")[1];
  return vyperVersionCache.versions.find(
    (version) => version.tag === versionNumber,
  )?.compiler_version;
};

export type EtherscanResult = {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  ConstructorArguments: string;
  EVMVersion: string;
  Library: string;
  LicenseType: string;
  Proxy: string;
  Implementation: string;
  SwarmSource: string;
};

export const parseEtherscanJsonInput = (sourceCodeObject: string) => {
  // Etherscan wraps the json object: {{ ... }}
  return JSON.parse(sourceCodeObject.slice(1, -1));
};

export const isEtherscanMultipleFilesObject = (sourceCodeObject: string) => {
  try {
    return Object.keys(JSON.parse(sourceCodeObject)).length > 0;
  } catch (e) {
    return false;
  }
};

export const isEtherscanJsonInput = (sourceCodeObject: string) => {
  if (sourceCodeObject.startsWith("{{")) {
    return true;
  }
  return false;
};

export const getSolcJsonInputFromEtherscanResult = (
  etherscanResult: EtherscanResult,
  sources: Sources,
): SolidityJsonInput => {
  const generatedSettings = {
    optimizer: {
      enabled: etherscanResult.OptimizationUsed === "1",
      runs: parseInt(etherscanResult.Runs),
    },
    outputSelection: {
      "*": {
        "*": ["metadata", "evm.deployedBytecode.object"],
      },
    },
    evmVersion:
      etherscanResult.EVMVersion.toLowerCase() !== "default"
        ? etherscanResult.EVMVersion
        : undefined,
    libraries: {}, // TODO: Check the library format
  };
  const solcJsonInput = {
    language: "Solidity",
    sources,
    settings: generatedSettings,
  };
  return solcJsonInput;
};

export const getContractPathFromSourcesOrThrow = (
  contractName: string,
  sources: Sources,
  throwV2Errors: boolean,
): string => {
  logger.debug(
    "etherscan-util: Parsing sources for finding the contract path",
    {
      contractName,
    },
  );
  const startTime = Date.now();
  let contractPath: string | undefined;
  for (const [path, { content }] of Object.entries(sources)) {
    try {
      const ast = SolidityParser.parse(content);
      SolidityParser.visit(ast, {
        ContractDefinition: (node) => {
          if (node.name === contractName) {
            contractPath = path;
            return false; // Stop visiting
          }
        },
      });
    } catch (error) {
      // Just continue, because the relevant contract might be in a different source file.
      logger.warn(
        "etherscan-util: Error parsing source code. Ignoring this source.",
        {
          path,
          error,
        },
      );
    }
  }
  const endTime = Date.now();
  logger.debug("etherscan-util: Parsing for all sources done", {
    contractName,
    contractPath,
    timeInMs: endTime - startTime,
  });

  if (contractPath === undefined) {
    const errorMessage =
      "The sources returned by Etherscan don't include the expected contract definition.";
    throw throwV2Errors
      ? new MalformedEtherscanResponseError(errorMessage)
      : new BadRequestError(errorMessage);
  }
  return contractPath;
};

export const getVyperJsonInputFromSingleFileResult = (
  etherscanResult: EtherscanResult,
  sources: VyperJsonInput["sources"],
): VyperJsonInput => {
  const generatedSettings = {
    outputSelection: {
      "*": ["evm.deployedBytecode.object"],
    },
    evmVersion:
      etherscanResult.EVMVersion !== "Default"
        ? (etherscanResult.EVMVersion as any)
        : undefined,
    search_paths: ["."],
  };
  return {
    language: "Vyper",
    sources,
    settings: generatedSettings,
  };
};

export interface ProcessedEtherscanResult {
  compilerVersion: string;
  jsonInput: VyperJsonInput | SolidityJsonInput;
  contractPath: string;
  contractName: string;
}

export const fetchFromEtherscan = async (
  sourcifyChain: SourcifyChain,
  address: string,
  userApiKey?: string,
  throwV2Errors: boolean = false,
): Promise<EtherscanResult> => {
  if (!sourcifyChain.etherscanApi?.supported) {
    const errorMessage = `Requested chain ${sourcifyChain.chainId} is not supported for importing from Etherscan.`;
    throw throwV2Errors
      ? new ChainNotFoundError(errorMessage)
      : new BadRequestError(errorMessage);
  }

  const url = `https://api.etherscan.io/v2/api?chainid=${sourcifyChain.chainId}&module=contract&action=getsourcecode&address=${address}&apikey=`;
  const apiKey =
    userApiKey ||
    process.env[sourcifyChain.etherscanApi.apiKeyEnvName || ""] ||
    process.env.ETHERSCAN_API_KEY ||
    "";
  const secretUrl = url + apiKey;
  let response;
  logger.debug("Fetching from Etherscan", {
    url,
    chainId: sourcifyChain.chainId,
    address,
  });
  try {
    response = await fetch(secretUrl);
  } catch (error) {
    const errorMessage = `Request to ${url}[hidden] failed.`;
    throw throwV2Errors
      ? new EtherscanRequestFailedError(errorMessage)
      : new BadGatewayError(errorMessage);
  }
  logger.debug("Fetched from Etherscan", {
    url,
    chainId: sourcifyChain.chainId,
    address,
  });

  if (!response.ok) {
    logger.warn("Etherscan API error", {
      url,
      chainId: sourcifyChain.chainId,
      address,
      status: response.status,
      response: JSON.stringify(response),
    });
    const errorMessage = `Etherscan API responded with an error. Status code: ${response.status}.`;
    throw throwV2Errors
      ? new EtherscanRequestFailedError(errorMessage)
      : new BadGatewayError(errorMessage);
  }

  const resultJson = await response.json();

  if (
    resultJson.message === "NOTOK" &&
    resultJson.result.includes("rate limit reached")
  ) {
    logger.info("Etherscan Rate Limit", {
      url,
      chainId: sourcifyChain.chainId,
      address,
      resultJson,
    });
    const errorMessage = "Etherscan API rate limit reached, try later.";
    throw throwV2Errors
      ? new EtherscanLimitError(errorMessage)
      : new TooManyRequests(errorMessage);
  }

  if (resultJson.message === "NOTOK") {
    logger.error("Etherscan API error", {
      url,
      chainId: sourcifyChain.chainId,
      address,
      resultJson,
    });
    const errorMessage =
      "Error in Etherscan API response. Result message: " + resultJson.result;
    throw throwV2Errors
      ? new EtherscanRequestFailedError(errorMessage)
      : new BadGatewayError(errorMessage);
  }

  if (resultJson.result[0].SourceCode === "") {
    logger.info("Contract not found on Etherscan", {
      url,
      chainId: sourcifyChain.chainId,
      address,
    });
    const errorMessage = "This contract is not verified on Etherscan.";
    throw throwV2Errors
      ? new NotEtherscanVerifiedError(errorMessage)
      : new NotFoundError(errorMessage);
  }

  const contractResultJson = resultJson.result[0] as EtherscanResult;
  return contractResultJson;
};

export const processSolidityResultFromEtherscan = (
  contractResultJson: EtherscanResult,
  throwV2Errors: boolean,
): ProcessedEtherscanResult => {
  const sourceCodeObject = contractResultJson.SourceCode;
  const contractName = contractResultJson.ContractName;

  const compilerVersion =
    contractResultJson.CompilerVersion.charAt(0) === "v"
      ? contractResultJson.CompilerVersion.slice(1)
      : contractResultJson.CompilerVersion;

  let solcJsonInput: SolidityJsonInput;
  let contractPath: string | undefined;
  // SourceCode can be the Solidity code if there is only one contract file, or the json object if there are multiple files
  if (isEtherscanJsonInput(sourceCodeObject)) {
    logger.debug("Etherscan solcJsonInput contract found");
    solcJsonInput = parseEtherscanJsonInput(sourceCodeObject);

    if (solcJsonInput?.settings) {
      // Tell compiler to output metadata and bytecode
      solcJsonInput.settings.outputSelection["*"]["*"] = [
        "metadata",
        "evm.deployedBytecode.object",
      ];
    }

    contractPath = getContractPathFromSourcesOrThrow(
      contractName,
      solcJsonInput.sources,
      throwV2Errors,
    );
  } else if (isEtherscanMultipleFilesObject(sourceCodeObject)) {
    logger.debug("Etherscan Solidity multiple file contract found");
    const sources = JSON.parse(sourceCodeObject) as Sources;
    solcJsonInput = getSolcJsonInputFromEtherscanResult(
      contractResultJson,
      sources,
    );
    contractPath = getContractPathFromSourcesOrThrow(
      contractName,
      sources,
      throwV2Errors,
    );
  } else {
    logger.debug("Etherscan Solidity single file contract found");
    contractPath = contractResultJson.ContractName + ".sol";
    const sources = {
      [contractPath]: {
        content: sourceCodeObject,
      },
    };
    solcJsonInput = getSolcJsonInputFromEtherscanResult(
      contractResultJson,
      sources,
    );
  }

  return {
    compilerVersion,
    jsonInput: solcJsonInput,
    contractPath,
    contractName,
  };
};

export const processVyperResultFromEtherscan = async (
  contractResultJson: EtherscanResult,
  throwV2Errors: boolean,
): Promise<ProcessedEtherscanResult> => {
  const sourceCodeProperty = contractResultJson.SourceCode;

  const compilerVersion = await getVyperCompilerVersion(
    contractResultJson.CompilerVersion,
  );
  if (!compilerVersion) {
    const errorMessage =
      "Could not map the Vyper version from Etherscan to a valid compiler version.";
    throw throwV2Errors
      ? new MalformedEtherscanResponseError(errorMessage)
      : new BadRequestError(errorMessage);
  }

  let contractName: string;
  let contractPath: string;
  let vyperJsonInput: VyperJsonInput;
  if (isEtherscanJsonInput(sourceCodeProperty)) {
    logger.debug("Etherscan vyperJsonInput contract found");

    const parsedJsonInput = parseEtherscanJsonInput(sourceCodeProperty);

    // Etherscan derives the ContractName from the @title natspec. Therefore, we cannot use the ContractName to find the contract path.
    contractPath = Object.keys(parsedJsonInput.settings.outputSelection)[0];

    // contractPath can be also be "*" or "<unknown>", in the case of "<unknown>" both contractPath and contractName will be "<unknown>"
    if (contractPath === "*") {
      // in the case of "*", we extract the contract path from the sources using `ContractName`
      contractPath = Object.keys(parsedJsonInput.sources).find((source) =>
        source.includes(contractResultJson.ContractName),
      )!;
      if (!contractPath) {
        const errorMessage =
          "The json input sources in the response from Etherscan don't include the expected contract.";
        throw throwV2Errors
          ? new MalformedEtherscanResponseError(errorMessage)
          : new BadRequestError(errorMessage);
      }
    }

    // We need to use the name from the contractPath, because VyperCheckedContract uses it for selecting the compiler output.
    contractName = contractPath.split("/").pop()!.split(".")[0];

    vyperJsonInput = {
      language: "Vyper",
      sources: parsedJsonInput.sources,
      settings: parsedJsonInput.settings,
    };
  } else {
    logger.debug("Etherscan Vyper single file contract found");

    // Since the ContractName from Etherscan is derived from the @title natspec, it can contain spaces.
    // To be safe we also remove \n and \r characters
    contractName = contractResultJson.ContractName.replace(/\s+/g, "")
      .replace(/\n/g, "")
      .replace(/\r/g, "");
    contractPath = contractName + ".vy";

    // The Vyper compiler has a bug where it throws if there are \r characters in the source code:
    // https://github.com/vyperlang/vyper/issues/4297
    const sourceCode = sourceCodeProperty.replace(/\r/g, "");
    const sources = {
      [contractPath]: { content: sourceCode },
    };

    vyperJsonInput = getVyperJsonInputFromSingleFileResult(
      contractResultJson,
      sources,
    );
  }

  if (!vyperJsonInput.settings) {
    const errorMessage = "Couldn't get Vyper compiler settings from Etherscan.";
    throw throwV2Errors
      ? new MalformedEtherscanResponseError(errorMessage)
      : new BadRequestError(errorMessage);
  }

  return {
    compilerVersion,
    jsonInput: vyperJsonInput,
    contractPath,
    contractName,
  };
};

export const stringToBase64 = (str: string): string => {
  return Buffer.from(str, "utf8").toString("base64");
};

export const isVyperResult = (etherscanResult: EtherscanResult): boolean => {
  return etherscanResult.CompilerVersion.startsWith("vyper");
};

export async function getCompilationFromEtherscanResult(
  etherscanResult: EtherscanResult,
  solc: ISolidityCompiler,
  vyperCompiler: IVyperCompiler,
  throwV2Errors = false,
): Promise<SolidityCompilation | VyperCompilation> {
  let compilation: SolidityCompilation | VyperCompilation;

  if (isVyperResult(etherscanResult)) {
    const processedResult = await processVyperResultFromEtherscan(
      etherscanResult,
      throwV2Errors,
    );
    compilation = new VyperCompilation(
      vyperCompiler,
      processedResult.compilerVersion,
      processedResult.jsonInput as VyperJsonInput,
      {
        path: processedResult.contractPath,
        name: processedResult.contractName,
      },
    );
  } else {
    const processedResult = processSolidityResultFromEtherscan(
      etherscanResult,
      throwV2Errors,
    );
    compilation = new SolidityCompilation(
      solc,
      processedResult.compilerVersion,
      processedResult.jsonInput as SolidityJsonInput,
      {
        path: processedResult.contractPath,
        name: processedResult.contractName,
      },
    );
  }

  return compilation;
}
