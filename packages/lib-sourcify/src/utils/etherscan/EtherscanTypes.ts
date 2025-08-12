import {
  SolidityJsonInput,
  VyperJsonInput,
} from '@ethereum-sourcify/compilers-types';

export type EtherscanImportErrorCode =
  | 'etherscan_network_error'
  | 'etherscan_http_error'
  | 'etherscan_rate_limit'
  | 'etherscan_api_error'
  | 'etherscan_not_verified'
  | 'etherscan_missing_contract_definition'
  | 'etherscan_vyper_version_mapping_failed'
  | 'etherscan_missing_contract_in_json'
  | 'etherscan_missing_vyper_settings';

export interface EtherscanImportErrorDataRequired {
  status: number;
  apiErrorMessage: string;
  contractName: string;
  compilerVersion: string;
}

export type EtherscanImportErrorParameters =
  | {
      code:
        | 'etherscan_network_error'
        | 'etherscan_rate_limit'
        | 'etherscan_not_verified';
    }
  | ({
      code: 'etherscan_http_error';
    } & Pick<EtherscanImportErrorDataRequired, 'status'>)
  | ({
      code: 'etherscan_api_error';
    } & Pick<EtherscanImportErrorDataRequired, 'apiErrorMessage'>)
  | ({
      code:
        | 'etherscan_missing_contract_definition'
        | 'etherscan_missing_contract_in_json';
    } & Pick<EtherscanImportErrorDataRequired, 'contractName'>)
  | ({
      code: 'etherscan_vyper_version_mapping_failed';
    } & Pick<EtherscanImportErrorDataRequired, 'compilerVersion'>)
  | {
      code: 'etherscan_missing_vyper_settings';
    };

function getErrorMessageFromCode(params: EtherscanImportErrorParameters) {
  switch (params.code) {
    case 'etherscan_network_error':
      return `Network error while connecting to Etherscan API.`;
    case 'etherscan_http_error':
      return `Etherscan API returned HTTP ${params.status} error.`;
    case 'etherscan_rate_limit':
      return `Etherscan API rate limit reached, try later.`;
    case 'etherscan_api_error':
      return `Error in Etherscan API response. Result message: Invalid API Key`;
    case 'etherscan_not_verified':
      return `This contract is not verified on Etherscan.`;
    case 'etherscan_missing_contract_definition':
      return `Contract definition for "${params.contractName}" not found in Etherscan response sources.`;
    case 'etherscan_vyper_version_mapping_failed':
      return `Failed to map Vyper version "${params.compilerVersion}" from Etherscan to valid compiler version.`;
    case 'etherscan_missing_contract_in_json':
      return `Expected contract "${params.contractName}" not found in Etherscan JSON input sources.`;
    case 'etherscan_missing_vyper_settings':
      return 'Vyper compiler settings missing from Etherscan response.';
    // Unknown error
    default:
      return 'Unknown error.';
  }
}

export class EtherscanImportError extends Error {
  declare code: EtherscanImportErrorCode;
  constructor(
    params: { code: EtherscanImportErrorCode } & EtherscanImportErrorParameters,
  ) {
    super(getErrorMessageFromCode(params));
    this.code = params.code;
  }
}

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

export interface ProcessedEtherscanResult {
  compilerVersion: string;
  jsonInput: VyperJsonInput | SolidityJsonInput;
  contractPath: string;
  contractName: string;
}
