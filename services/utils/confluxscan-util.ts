import {
  SolidityJsonInput,
  Sources,
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
  console.log('confluxscan-util: generated compiler setting from confluxscan result', generatedSettings)
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
  console.debug("confluxscan-util: Parsing sources for finding the contract path", { contractName})
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
      console.warn("confluxscan-util: Error parsing source code. Ignoring this source.", { path, error})
    }
  }
  console.debug("confluxscan-util: Parsing for all sources done", { contractName, contractPath, timeInMs: Date.now() - startTime})

  if (contractPath === undefined) {
    throw new MalformedConfluxscanResponseError("The sources returned by Confluxscan don't include the expected contract definition.")
  }

  return contractPath;
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
  if (!chain.confluxscanApi) {
    const errorMessage = `Requested chain ${chain.chainId} is not supported for importing from Confluxscan.`;
    throw new ChainNotFoundError(errorMessage)
  }

  const url = chain.corespace ?
    `${chain.confluxscanApi.apiURL}/contract/getsourcecode?address=${address}`:
    `${chain.confluxscanApi.apiURL}/api?module=contract&action=getsourcecode&address=${address}`
  const usedApiKey = apiKey || process.env[chain.confluxscanApi.apiKeyEnvName || ""];
  console.debug("Fetching from Confluxscan", {
    url,
    chainId: chain.chainId,
    address,
  });
  let response;
  try {
    response = await fetch(`${url}&apikey=${usedApiKey || ""}`);
  } catch (error) {
    throw new ConfluxscanRequestFailedError(`Request to ${url}&apiKey=XXX failed.`)
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
    throw new ConfluxscanRequestFailedError(`Confluxscan API responded with an error. Status code: ${response.status}.`)
  }

  let resultJson = await response.json();
  resultJson = toEspaceResult(resultJson, chain.corespace)
  if (resultJson.message === "NOTOK" && resultJson.result.includes("rate limit reached")) {
    console.info("Confluxscan Rate Limit", {
      url,
      chainId: chain.chainId,
      address,
      resultJson,
    });
    throw new ConfluxscanLimitError("Confluxscan API rate limit reached, try later.")
  }

  if (resultJson.message === "NOTOK") {
    console.error("Confluxscan API error", {
      url,
      chainId: chain.chainId,
      address,
      resultJson,
    });
    throw new ConfluxscanRequestFailedError("Error in Confluxscan API response. Result message: " + resultJson.result)
  }

  if (resultJson.result[0].SourceCode === "") {
    console.info("Contract not found on Confluxscan", {
      url,
      chainId: chain.chainId,
      address,
    });
    throw new NotConfluxscanVerifiedError("This contract is not verified on Confluxscan.")
  }

  return resultJson.result[0] as ConfluxscanResult;
}

export const processSolidityResultFromConfluxscan = (
  contractResultJson: ConfluxscanResult
): ProcessedConfluxscanResult => {
  const sourceCodeObject = contractResultJson.SourceCode;
  const contractName = contractResultJson.ContractName;

  const compilerVersion = contractResultJson.CompilerVersion.charAt(0) === "v"
      ? contractResultJson.CompilerVersion.slice(1) : contractResultJson.CompilerVersion;

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
    contractPath = getContractPathFromSourcesOrThrow(contractName, solcJsonInput.sources)
  } else if (isConfluxscanMultipleFilesObject(sourceCodeObject)) {
    console.debug("Confluxscan Solidity multiple file contract found");
    const sources = JSON.parse(sourceCodeObject) as Sources
    solcJsonInput = getSolcJsonInputFromConfluxscanResult(contractResultJson, sources)
    contractPath = getContractPathFromSourcesOrThrow(contractName, sources)
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

function toEspaceResult(json: any, corespace: boolean) {
  if(!corespace) {
    return json
  }

  json["status"] = json.code === 0 ? "1" : "0"
  json["result"] = json.data
  delete json["code"]
  delete json["data"]

  return json
}
