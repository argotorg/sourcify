export class EtherscanChainNotSupportedLibError extends Error {
  code = 'etherscan_chain_not_supported' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EtherscanChainNotSupportedLibError';
  }
}

export class EtherscanRequestFailedLibError extends Error {
  code = 'etherscan_request_failed' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EtherscanRequestFailedLibError';
  }
}

export class EtherscanLimitLibError extends Error {
  code = 'etherscan_limit' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EtherscanLimitLibError';
  }
}

export class NotEtherscanVerifiedLibError extends Error {
  code = 'not_etherscan_verified' as const;
  constructor(message: string) {
    super(message);
    this.name = 'NotEtherscanVerifiedLibError';
  }
}

export class MalformedEtherscanResponseLibError extends Error {
  code = 'malformed_etherscan_response' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MalformedEtherscanResponseLibError';
  }
}

