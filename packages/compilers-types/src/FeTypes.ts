export interface FeSettings {
  /** EVM version to compile for */
  evmVersion?: string;
  /** Fe does not use outputSelection — defined as undefined for type compatibility */
  outputSelection?: undefined;
}

export interface FeJsonInput {
  language: 'Fe';
  /** Source files keyed by path relative to src/ */
  sources: {
    [sourcePath: string]: {
      content: string;
    };
  };
  settings?: FeSettings;
}

export interface FeOutputContract {
  /** ABI is not emitted by `fe build` — null when not available */
  abi: null | any[];
  /** Fe does not emit userdoc */
  userdoc?: undefined;
  /** Fe does not emit devdoc */
  devdoc?: undefined;
  evm: {
    bytecode: {
      /** Hex string without 0x prefix */
      object: string;
    };
    deployedBytecode: {
      /** Hex string without 0x prefix */
      object: string;
      /** Fe does not emit source maps */
      sourceMap?: undefined;
    };
  };
}

export interface FeOutputError {
  severity: 'error' | 'warning';
  message: string;
}

interface FeOutputContracts {
  [sourcePath: string]: {
    [contractName: string]: FeOutputContract;
  };
}

export interface FeOutput {
  compiler: string;
  errors?: FeOutputError[];
  contracts: FeOutputContracts;
  /** Fe compiler does not emit source IDs — this field is always absent */
  sources?: undefined;
}
