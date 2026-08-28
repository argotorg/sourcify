import type { JsonFragment } from "ethers";
import type {
  SolidityJsonInput,
  SolidityOutputError,
  SoliditySettings,
} from "./SolidityTypes";
import type { VyperJsonInput, VyperOutputError } from "./VyperTypes";
import type { FeJsonInput } from "./FeTypes";

// Machine-readable discriminators set on the `.code` of the Error thrown when a
// native compiler subprocess dies. Shared here so both the compilers package
// (which sets them) and lib-sourcify (which maps them to a CompilationErrorCode)
// reference the same value instead of duplicating the magic string. See #2880.
export const COMPILER_TIMEOUT_CODE = "COMPILER_TIMEOUT";
export const COMPILER_OOM_CODE = "COMPILER_OOM";

export interface LinkReferences {
  [filePath: string]: {
    [libraryName: string]: [
      {
        length: number;
        start: number;
      },
    ];
  };
}

export interface MetadataSource {
  keccak256: string;
  content?: string;
  urls?: string[];
  license?: string;
}

export interface MetadataSourceMap {
  [index: string]: MetadataSource;
}

export interface Devdoc {
  author?: string;
  details?: string;
  errors?: {
    [index: string]: {
      details?: string;
    };
  };
  events?: {
    [index: string]: {
      details?: string;
      params?: any;
    };
  };
  kind: "dev";
  methods: {
    [index: string]: {
      details?: string;
      params?: any;
      returns?: any;
    };
  };
  stateVariables?: any;
  title?: string;
  version?: number;
}

export interface Userdoc {
  errors?: {
    [index: string]: {
      notice?: string;
    }[];
  };
  events?: {
    [index: string]: {
      notice?: string;
    };
  };
  kind: "user";
  methods: {
    [index: string]: {
      notice: string;
    };
  };
  version?: number;
}

// Shared OutputError type between Solidity and Vyper
export type OutputError = SolidityOutputError | VyperOutputError;

export interface MetadataOutput {
  abi: JsonFragment[];
  devdoc?: Devdoc;
  userdoc?: Userdoc;
}

// Metadata JSON's "settings" does have extra "compilationTarget" and its "libraries" field is in a different format
// ( libraries["MyContract.sol:Mycontract"]:"0xab..cd" vs libraries["MyContract.sol"]["MyContract"]:"0xab..cd")
export interface MetadataCompilerSettings extends Omit<
  SoliditySettings,
  "libraries" | "outputSelection"
> {
  compilationTarget: {
    [sourceName: string]: string;
  };
  libraries?: {
    [index: string]: string;
  };
}

// Metadata type that reflects the metadata object from
// https://docs.soliditylang.org/en/latest/metadata.html
export interface Metadata {
  compiler: {
    keccak256?: string;
    version: string;
  };
  language: string;
  output: MetadataOutput;
  settings: MetadataCompilerSettings;
  sources: MetadataSourceMap;
  version: number;
}

export type AnyJsonInput = SolidityJsonInput | VyperJsonInput | FeJsonInput;
