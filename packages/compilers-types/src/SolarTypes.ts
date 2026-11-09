import type {
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
  SolidityOutputEvmBytecode,
  SolidityOutputEvmDeployedBytecode,
  SoliditySettings,
} from "./SolidityTypes";

// Solar takes the solc standard JSON input with its own extra settings
export interface SolarSettings extends SoliditySettings {
  // Unstable flags that change the output
  solar?: {
    unstable?: string[];
  };
}

export interface SolarJsonInput extends SolidityJsonInput {
  settings: SolarSettings;
}

// CBOR auxdata trailers keyed by the fully qualified name of the owning contract
export interface SolarCborAuxdata {
  [fullyQualifiedName: string]: Array<{
    offset: number;
    value: string;
  }>;
}

export interface SolarOutputEvmBytecode extends SolidityOutputEvmBytecode {
  cborAuxdata?: SolarCborAuxdata;
}

export interface SolarOutputEvmDeployedBytecode extends SolidityOutputEvmDeployedBytecode {
  cborAuxdata?: SolarCborAuxdata;
}

export interface SolarOutputContract extends SolidityOutputContract {
  evm: SolidityOutputContract["evm"] & {
    bytecode: SolarOutputEvmBytecode;
    deployedBytecode: SolarOutputEvmDeployedBytecode;
  };
}

export interface SolarOutput extends SolidityOutput {
  contracts: {
    [globalName: string]: {
      [contractName: string]: SolarOutputContract;
    };
  };
}

// Solar reports a solc-compatible version: <solc>+commit.<sha8>.solar.<solar version>
const SOLAR_VERSION_REGEX =
  /^v?(\d+\.\d+\.\d+)\+commit\.([0-9a-f]{8})\.solar\.(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export interface SolarVersion {
  // The solc version that Solar emulates, e.g. 0.8.38
  solcVersion: string;
  // The Solar commit, 8 hex digits
  commit: string;
  // The Solar version, e.g. 0.3.0, or 0.3.0-dev for builds that are not a release
  solarVersion: string;
}

export function parseSolarVersion(version: string): SolarVersion | undefined {
  // Stored or user data may lack a version
  if (typeof version !== "string") {
    return undefined;
  }
  const match = SOLAR_VERSION_REGEX.exec(version.trim());
  if (!match) {
    return undefined;
  }
  return {
    solcVersion: match[1],
    commit: match[2],
    solarVersion: match[3],
  };
}

export function isSolarVersion(version: string): boolean {
  return parseSolarVersion(version) !== undefined;
}
