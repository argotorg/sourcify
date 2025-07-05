import { Abi } from "abitype";
import { SolidityOutputError, SoliditySettings } from "./SolidityTypes";
import { VyperOutputError } from "./VyperTypes";

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
  abi: Abi;
  devdoc?: Devdoc;
  userdoc?: Userdoc;
}

// Metadata JSON's "settings" does have extra "compilationTarget" and its "libraries" field is in a different format
// ( libraries["MyContract.sol:Mycontract"]:"0xab..cd" vs libraries["MyContract.sol"]["MyContract"]:"0xab..cd")
export interface MetadataCompilerSettings
  extends Omit<SoliditySettings, "libraries" | "outputSelection"> {
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
