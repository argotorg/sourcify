import { Abi } from "abitype";
import { Devdoc } from "./CompilationTypes";
import { Userdoc } from "./CompilationTypes";

export interface VyperSettings {
  /** EVM version to compile for */
  evmVersion?: "london" | "paris" | "shanghai" | "cancun" | "istanbul";
  /** Optimization mode */
  optimize?: "gas" | "codesize" | "none" | boolean;
  /** Whether the bytecode should include Vyper's signature */
  bytecodeMetadata?: boolean;
  /** Whether to use the experimental venom pipeline */
  experimentalCodegen?: boolean;
  /** The search paths to use for resolving imports */
  search_paths?: string[];
  outputSelection: {
    [key: string]: string[] | { [contractName: string]: string[] };
  };
}

export interface VyperJsonInput {
  language: "Vyper";
  sources: {
    [sourcePath: string]: {
      keccak256?: string;
      content: string;
    };
  };
  /**
   * Optional: Sources made available for import by the compiled contracts.
   * For .vy suffix, compiler expects Vyper syntax.
   * For .json suffix, compiler expects an ABI object.
   */
  interfaces?: {
    [interfacePath: string]: {
      content?: string;
      abi?: any[];
    };
  };
  settings: VyperSettings;
}

export interface VyperOutputError {
  sourceLocation?: {
    file: string;
    lineno: number;
    col_offset: number;
  };
  type: string;
  component: string;
  severity: "error" | "warning";
  message: string;
  formattedMessage?: string;
}

export interface VyperOutputSource {
  id: number;
  ast: any;
}

export interface VyperOutputSources {
  [sourcePath: string]: VyperOutputSource;
}

export interface VyperOutputContract {
  abi: Abi;
  userdoc: Userdoc;
  devdoc: Devdoc;
  ir: string;
  evm: {
    bytecode: {
      object: string;
      opcodes: string;
    };
    deployedBytecode: {
      object: string;
      opcodes: string;
      sourceMap: string;
    };
    methodIdentifiers: {
      [methodName: string]: string;
    };
  };
}

interface VyperOutputContracts {
  [sourcePath: string]: {
    [contractName: string]: VyperOutputContract;
  };
}

export interface VyperOutput {
  compiler: string;
  errors?: VyperOutputError[];
  sources: VyperOutputSources;
  contracts: VyperOutputContracts;
}
