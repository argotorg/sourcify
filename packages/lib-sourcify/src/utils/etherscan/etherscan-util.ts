import {
  ISolidityCompiler,
  IVyperCompiler,
  SolidityJsonInput,
  VyperJsonInput,
  VyperCompilation,
  SolidityCompilation,
  Sources,
} from '../..';
import { getContractPathFromSources } from '../..';
import { logInfo, logDebug, logWarn, logError } from '../../logger';
import { EtherscanImportError } from './EtherscanImportErrors';

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
  if (
    !vyperVersionCache ||
    now - vyperVersionCache.lastFetch > cacheDurationMs
  ) {
    try {
      const response = await fetch(
        'https://vyper-releases-mirror.hardhat.org/list.json',
      );
      const versions = await response.json();
      vyperVersionCache = {
        versions: versions.map((version: any) => ({
          compiler_version: version.assets[0]?.name
            .replace('vyper.', '')
            .replace('.darwin', '')
            .replace('.linux', '')
            .replace('.windows.exe', ''),
          tag: version.tag_name.substring(1),
        })),
        lastFetch: now,
      };
    } catch (error) {
      logError('Failed to fetch Vyper versions', { error });
      if (vyperVersionCache) {
        logWarn('Using stale Vyper versions cache');
      } else {
        throw error;
      }
    }
  }

  if (!vyperVersionCache) return undefined;
  const versionNumber = compilerString.split(':')[1];
  let found = vyperVersionCache.versions.find(
    (v) => v.tag === versionNumber,
  )?.compiler_version;
  if (!found) {
    // If not found, try a one-time refresh to capture newly added versions
    try {
      const response = await fetch(
        'https://vyper-releases-mirror.hardhat.org/list.json',
      );
      const versions = await response.json();
      vyperVersionCache = {
        versions: versions.map((version: any) => ({
          compiler_version: version.assets[0]?.name
            .replace('vyper.', '')
            .replace('.darwin', '')
            .replace('.linux', '')
            .replace('.windows.exe', ''),
          tag: version.tag_name.substring(1),
        })),
        lastFetch: Date.now(),
      };
      found = vyperVersionCache.versions.find(
        (v) => v.tag === versionNumber,
      )?.compiler_version;
    } catch (error) {
      logWarn('Failed to refresh Vyper versions for missing tag', {
        versionNumber,
        error,
      });
    }
  }
  return found;
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
  } catch {
    return false;
  }
};

export const isEtherscanJsonInput = (sourceCodeObject: string) =>
  sourceCodeObject.startsWith('{{');

export const getSolcJsonInputFromEtherscanResult = (
  etherscanResult: EtherscanResult,
  sources: Sources,
): SolidityJsonInput => {
  const generatedSettings = {
    optimizer: {
      enabled: etherscanResult.OptimizationUsed === '1',
      runs: parseInt(etherscanResult.Runs),
    },
    evmVersion:
      etherscanResult.EVMVersion.toLowerCase() !== 'default'
        ? etherscanResult.EVMVersion
        : undefined,
    libraries: {},
  } as SolidityJsonInput['settings'];

  return {
    language: 'Solidity',
    sources,
    settings: generatedSettings,
  };
};

export const getContractPathFromSourcesOrThrow = (
  contractName: string,
  sources: Sources,
): string => {
  const contractPath = getContractPathFromSources(contractName, sources);
  if (contractPath === undefined) {
    throw new EtherscanImportError({
      code: 'etherscan_missing_contract_definition',
      contractName,
    });
  }
  return contractPath;
};

export const getVyperJsonInputFromSingleFileResult = (
  etherscanResult: EtherscanResult,
  sources: VyperJsonInput['sources'],
): VyperJsonInput => {
  const generatedSettings: VyperJsonInput['settings'] = {
    outputSelection: {
      '*': ['evm.deployedBytecode.object'],
    },
    evmVersion:
      etherscanResult.EVMVersion !== 'Default'
        ? (etherscanResult.EVMVersion as any)
        : undefined,
    search_paths: ['.'],
  };
  return {
    language: 'Vyper',
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
  chainId: number | string,
  address: string,
  apiKey: string = '',
): Promise<EtherscanResult> => {
  let url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=`;
  const secretUrl = url + apiKey;
  url = url + (apiKey ? apiKey.slice(0, 6) + '...' : '');

  let response: any;
  logInfo('Fetching from Etherscan', {
    url,
    chainId,
    address,
  });
  try {
    response = await fetch(secretUrl);
  } catch {
    throw new EtherscanImportError({
      code: 'etherscan_network_error',
      url,
      chainId,
      address,
    });
  }
  logDebug('Fetched from Etherscan', {
    url,
    chainId,
    address,
  });

  if (!response.ok) {
    logWarn('Etherscan API error', {
      url,
      chainId,
      address,
      status: (response as any).status,
      response: JSON.stringify(response),
    });
    throw new EtherscanImportError({
      code: 'etherscan_http_error',
      url,
      chainId,
      address,
      status: (response as any).status,
    });
  }

  const resultJson: any = await (response as any).json();

  if (
    resultJson.message === 'NOTOK' &&
    resultJson.result.includes('rate limit reached')
  ) {
    logInfo('Etherscan Rate Limit', {
      url,
      chainId,
      address,
      resultJson,
    });
    throw new EtherscanImportError({
      code: 'etherscan_rate_limit',
      url,
      chainId,
      address,
    });
  }

  if (resultJson.message === 'NOTOK') {
    logError('Etherscan API error', {
      url,
      chainId,
      address,
      resultJson,
    });
    throw new EtherscanImportError({
      code: 'etherscan_api_error',
      url,
      chainId,
      address,
      apiErrorMessage: resultJson.result,
    });
  }

  if (resultJson.result[0].SourceCode === '') {
    logInfo('Contract not found on Etherscan', {
      url,
      chainId,
      address,
    });
    throw new EtherscanImportError({
      code: 'etherscan_not_verified',
      url,
      chainId,
      address,
    });
  }

  const contractResultJson = resultJson.result[0] as EtherscanResult;
  return contractResultJson;
};

export const processSolidityResultFromEtherscan = (
  contractResultJson: EtherscanResult,
): ProcessedEtherscanResult => {
  const sourceCodeObject = contractResultJson.SourceCode;
  const contractName = contractResultJson.ContractName;

  const compilerVersion =
    contractResultJson.CompilerVersion.charAt(0) === 'v'
      ? contractResultJson.CompilerVersion.slice(1)
      : contractResultJson.CompilerVersion;

  let solcJsonInput: SolidityJsonInput;
  let contractPath: string | undefined;
  if (isEtherscanJsonInput(sourceCodeObject)) {
    logDebug('Etherscan solcJsonInput contract found');
    solcJsonInput = parseEtherscanJsonInput(sourceCodeObject);
    contractPath = getContractPathFromSourcesOrThrow(
      contractName,
      solcJsonInput.sources,
    );
  } else if (isEtherscanMultipleFilesObject(sourceCodeObject)) {
    logDebug('Etherscan Solidity multiple file contract found');
    const sources = JSON.parse(sourceCodeObject) as Sources;
    solcJsonInput = getSolcJsonInputFromEtherscanResult(
      contractResultJson,
      sources,
    );
    contractPath = getContractPathFromSourcesOrThrow(contractName, sources);
  } else {
    logDebug('Etherscan Solidity single file contract found');
    contractPath = contractResultJson.ContractName + '.sol';
    const sources = {
      [contractPath]: { content: sourceCodeObject },
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
): Promise<ProcessedEtherscanResult> => {
  const sourceCodeProperty = contractResultJson.SourceCode;

  const compilerVersion = await getVyperCompilerVersion(
    contractResultJson.CompilerVersion,
  );
  if (!compilerVersion) {
    throw new EtherscanImportError({
      code: 'etherscan_vyper_version_mapping_failed',
      compilerVersion: contractResultJson.CompilerVersion,
    });
  }

  let contractName: string;
  let contractPath: string;
  const isJsonInput = isEtherscanJsonInput(sourceCodeProperty);
  let vyperJsonInput: VyperJsonInput;
  if (isJsonInput) {
    logDebug('Etherscan vyperJsonInput contract found');
    const parsedJsonInput = parseEtherscanJsonInput(sourceCodeProperty);
    contractPath = Object.keys(parsedJsonInput.settings.outputSelection)[0];
    if (contractPath === '*') {
      contractPath = Object.keys(parsedJsonInput.sources).find((source) =>
        source.includes(contractResultJson.ContractName),
      )!;
      if (!contractPath) {
        throw new EtherscanImportError({
          code: 'etherscan_missing_contract_in_json',
          contractName: contractResultJson.ContractName,
        });
      }
    }
    contractName = contractPath.split('/').pop()!.split('.')[0];
    vyperJsonInput = {
      language: 'Vyper',
      sources: parsedJsonInput.sources,
      settings: parsedJsonInput.settings,
    };
  } else {
    logDebug('Etherscan Vyper single file contract found');
    contractName = contractResultJson.ContractName.replace(/\s+/g, '')
      .replace(/\n/g, '')
      .replace(/\r/g, '');
    contractPath = contractName + '.vy';
    const sourceCode = sourceCodeProperty.replace(/\r/g, '');
    const sources = { [contractPath]: { content: sourceCode } };
    vyperJsonInput = getVyperJsonInputFromSingleFileResult(
      contractResultJson,
      sources,
    );
  }

  if (!vyperJsonInput.settings) {
    throw new EtherscanImportError({
      code: 'etherscan_missing_vyper_settings',
    });
  }

  return {
    compilerVersion,
    jsonInput: vyperJsonInput,
    contractPath,
    contractName,
  };
};

export const stringToBase64 = (str: string): string =>
  Buffer.from(str, 'utf8').toString('base64');

export const isVyperResult = (etherscanResult: EtherscanResult): boolean =>
  etherscanResult.CompilerVersion.startsWith('vyper');

export async function getCompilationFromEtherscanResult(
  etherscanResult: EtherscanResult,
  solc: ISolidityCompiler,
  vyperCompiler: IVyperCompiler,
): Promise<SolidityCompilation | VyperCompilation> {
  let compilation: SolidityCompilation | VyperCompilation;
  if (isVyperResult(etherscanResult)) {
    const processedResult =
      await processVyperResultFromEtherscan(etherscanResult);
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
    const processedResult = processSolidityResultFromEtherscan(etherscanResult);
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
