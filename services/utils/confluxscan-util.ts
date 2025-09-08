import {
  SolidityJsonInput,
  Sources,
  VyperJsonInput,
} from "@ethereum-sourcify/lib-sourcify";
import {
  ChainNotFoundError,
  ConfluxscanLimitError,
  ConfluxscanRequestFailedError,
  MalformedConfluxscanResponseError,
  NotConfluxscanVerifiedError,
} from "../../routes/api/errors";
import SolidityParser from "@solidity-parser/parser";
import { Chain } from "../chain/Chain";

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
      const versions: any = await response.json();
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
      console.error("Failed to fetch Vyper versions", { error });
      // If cache exists but is stale, use it rather than failing
      if (vyperVersionCache) {
        console.warn("Using stale Vyper versions cache");
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

export type ConfluxscanResult = {
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

export const parseConfluxscanJsonInput = (sourceCodeObject: string) => {
  // Confluxscan wraps the json object: {{ ... }}
  return JSON.parse(sourceCodeObject.slice(1, -1));
};

export const isConfluxscanMultipleFilesObject = (sourceCodeObject: string) => {
  try {
    return Object.keys(JSON.parse(sourceCodeObject)).length > 0;
  } catch (e) {
    return false;
  }
};

export const isConfluxscanJsonInput = (sourceCodeObject: string) => {
  if (sourceCodeObject.startsWith("{{")) {
    return true;
  }
  return false;
};

export const getSolcJsonInputFromConfluxscanResult = (
  confluxscanResult: ConfluxscanResult,
  sources: Sources,
): SolidityJsonInput => {
  const generatedSettings = {
    optimizer: {
      enabled: confluxscanResult.OptimizationUsed === "1",
      runs: parseInt(confluxscanResult.Runs),
    },
    outputSelection: {
      "*": {
        "*": ["metadata", "evm.deployedBytecode.object"],
      },
    },
    evmVersion:
      confluxscanResult.EVMVersion.toLowerCase() !== "default"
        ? confluxscanResult.EVMVersion
        : undefined,
    libraries: {}, // TODO: Check the library format
  };
  console.log(
    "confluxscan-util: generated compiler setting from confluxscan result",
    generatedSettings,
  );
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
): string => {
  console.debug(
    "confluxscan-util: Parsing sources for finding the contract path",
    { contractName },
  );
  let contractPath: string | undefined;
  const startTime = Date.now();
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
      console.warn(
        "confluxscan-util: Error parsing source code. Ignoring this source.",
        { path, error },
      );
    }
  }
  console.debug("confluxscan-util: Parsing for all sources done", {
    contractName,
    contractPath,
    timeInMs: Date.now() - startTime,
  });

  if (contractPath === undefined) {
    throw new MalformedConfluxscanResponseError(
      "The sources returned by Confluxscan don't include the expected contract definition.",
    );
  }

  return contractPath;
};

export const getVyperJsonInputFromSingleFileResult = (
  confluxscanResult: ConfluxscanResult,
  sources: VyperJsonInput["sources"],
): VyperJsonInput => {
  const generatedSettings = {
    outputSelection: {
      "*": ["evm.deployedBytecode.object"],
    },
    evmVersion:
      confluxscanResult.EVMVersion !== "Default"
        ? (confluxscanResult.EVMVersion as any)
        : undefined,
    search_paths: ["."],
  };
  return {
    language: "Vyper",
    sources,
    settings: generatedSettings,
  };
};

export interface ProcessedConfluxscanResult {
  compilerVersion: string;
  jsonInput: SolidityJsonInput;
  contractPath: string;
  contractName: string;
}

export const fetchFromConfluxscan = async (
  chain: Chain,
  address: string,
  apiKey?: string,
): Promise<ConfluxscanResult> => {
  if (!chain?.confluxscanApi) {
    const errorMessage = `Requested chain ${chain?.chainId} is not supported for importing from Confluxscan.`;
    throw new ChainNotFoundError(errorMessage);
  }

  const url = chain.corespace
    ? `${chain.confluxscanApi.apiURL}/contract/getsourcecode?address=${address}`
    : `${chain.confluxscanApi.apiURL}/api?module=contract&action=getsourcecode&address=${address}`;
  const usedApiKey =
    apiKey || process.env[chain.confluxscanApi.apiKeyEnvName || ""];
  console.debug("Fetching from Confluxscan", {
    url,
    chainId: chain.chainId,
    address,
  });
  let response;
  try {
    response = await fetch(`${url}&apikey=${usedApiKey || ""}`);
  } catch (e) {
    throw new ConfluxscanRequestFailedError(
      `Request to ${url}&apiKey=XXX failed.`,
    );
  }
  console.debug("Fetched from Confluxscan", {
    url,
    chainId: chain.chainId,
    address,
  });

  if (!response.ok) {
    console.warn("Confluxscan API error", {
      url,
      chainId: chain.chainId,
      address,
      status: response.status,
      response: JSON.stringify(response),
    });
    throw new ConfluxscanRequestFailedError(
      `Confluxscan API responded with an error. Status code: ${response.status}.`,
    );
  }

  let resultJson = await response.json();
  resultJson = toEspaceResult(resultJson, chain.corespace);
  if (
    resultJson.message === "NOTOK" &&
    resultJson.result.includes("rate limit reached")
  ) {
    console.info("Confluxscan Rate Limit", {
      url,
      chainId: chain.chainId,
      address,
      resultJson,
    });
    throw new ConfluxscanLimitError(
      "Confluxscan API rate limit reached, try later.",
    );
  }

  if (resultJson.message === "NOTOK") {
    console.error("Confluxscan API error", {
      url,
      chainId: chain.chainId,
      address,
      resultJson,
    });
    throw new ConfluxscanRequestFailedError(
      "Error in Confluxscan API response. Result message: " + resultJson.result,
    );
  }

  if (resultJson.result[0].SourceCode === "") {
    console.info("Contract not found on Confluxscan", {
      url,
      chainId: chain.chainId,
      address,
    });
    throw new NotConfluxscanVerifiedError(
      "This contract is not verified on Confluxscan.",
    );
  }

  return resultJson.result[0] as ConfluxscanResult;
};

export const processSolidityResultFromConfluxscan = (
  contractResultJson: ConfluxscanResult,
): ProcessedConfluxscanResult => {
  const sourceCodeObject = contractResultJson.SourceCode;
  const contractName = contractResultJson.ContractName;

  const compilerVersion =
    contractResultJson.CompilerVersion.charAt(0) === "v"
      ? contractResultJson.CompilerVersion.slice(1)
      : contractResultJson.CompilerVersion;

  let solcJsonInput: SolidityJsonInput;
  let contractPath: string | undefined;
  // SourceCode can be the Solidity code if there is only one contract file, or the json object if there are multiple files
  if (isConfluxscanJsonInput(sourceCodeObject)) {
    console.debug("Confluxscan solcJsonInput contract found");
    solcJsonInput = parseConfluxscanJsonInput(sourceCodeObject);
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
    );
  } else if (isConfluxscanMultipleFilesObject(sourceCodeObject)) {
    console.debug("Confluxscan Solidity multiple file contract found");
    const sources = JSON.parse(sourceCodeObject) as Sources;
    solcJsonInput = getSolcJsonInputFromConfluxscanResult(
      contractResultJson,
      sources,
    );
    contractPath = getContractPathFromSourcesOrThrow(contractName, sources);
  } else {
    console.debug("Confluxscan Solidity single file contract found");
    contractPath = contractResultJson.ContractName + ".sol";
    const sources = {
      [contractPath]: {
        content: sourceCodeObject,
      },
    };
    solcJsonInput = getSolcJsonInputFromConfluxscanResult(
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

export const processVyperResultFromConfluxscan = async (
  contractResultJson: ConfluxscanResult,
): Promise<ProcessedConfluxscanResult> => {
  const sourceCodeProperty = contractResultJson.SourceCode;

  const compilerVersion = await getVyperCompilerVersion(
    contractResultJson.CompilerVersion,
  );
  if (!compilerVersion) {
    const errorMessage =
      "Could not map the Vyper version from Confluxscan to a valid compiler version.";
    throw new MalformedConfluxscanResponseError(errorMessage);
  }

  let contractName: string;
  let contractPath: string;
  let vyperJsonInput: VyperJsonInput;
  if (isConfluxscanJsonInput(sourceCodeProperty)) {
    console.debug("Confluxscan vyperJsonInput contract found");

    const parsedJsonInput = parseConfluxscanJsonInput(sourceCodeProperty);

    // Confluxscan derives the ContractName from the @title natspec. Therefore, we cannot use the ContractName to find the contract path.
    contractPath = Object.keys(parsedJsonInput.settings.outputSelection)[0];

    // contractPath can be also be "*" or "<unknown>", in the case of "<unknown>" both contractPath and contractName will be "<unknown>"
    if (contractPath === "*") {
      // in the case of "*", we extract the contract path from the sources using `ContractName`
      contractPath = Object.keys(parsedJsonInput.sources).find((source) =>
        source.includes(contractResultJson.ContractName),
      )!;
      if (!contractPath) {
        const errorMessage =
          "The json input sources in the response from Confluxscan don't include the expected contract.";
        throw new MalformedConfluxscanResponseError(errorMessage);
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
    console.debug("Confluxscan Vyper single file contract found");

    // Since the ContractName from Confluxscan is derived from the @title natspec, it can contain spaces.
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
    const errorMessage =
      "Couldn't get Vyper compiler settings from Confluxscan.";
    throw new MalformedConfluxscanResponseError(errorMessage);
  }

  return {
    compilerVersion,
    jsonInput: vyperJsonInput,
    contractPath,
    contractName,
  };
};

export const isVyperResult = (
  confluxscanResult: ConfluxscanResult,
): boolean => {
  return confluxscanResult.CompilerVersion.startsWith("vyper");
};

function toEspaceResult(json: any, corespace?: boolean) {
  if (!corespace) {
    return json;
  }

  json["status"] = json.code === 0 ? "1" : "0";
  json["result"] = json.data;
  delete json["code"];
  delete json["data"];

  return json;
}
