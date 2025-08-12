import {
  SolidityJsonInput,
  VyperJsonInput,
} from '@ethereum-sourcify/compilers-types';
import {
  SourcifyLibErrorParameters,
  SourcifyLibError,
} from '../../SourcifyLibError';

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

export class EtherscanImportError extends SourcifyLibError {
  declare code: EtherscanImportErrorCode;
  constructor(
    params: SourcifyLibErrorParameters & { code: EtherscanImportErrorCode },
  ) {
    super(params);
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
