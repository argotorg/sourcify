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
