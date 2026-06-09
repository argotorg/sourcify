import type { JsonFragment } from "ethers";
import type { Devdoc } from "./CompilationTypes";
import type { Userdoc } from "./CompilationTypes";
import type { ImmutableReferences } from "./SolidityTypes";

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
  storage_layout_overrides?: {
    [sourcePath: string]: VyperStorageLayout;
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

export interface VyperSourceMap {
  breakpoints: number[];
  error_map: Record<string, string>;
  pc_ast_map: Record<string, number[]>;
  pc_ast_map_item_keys: string[];
  pc_breakpoints: number[];
  pc_jump_map: Record<string, string>;
  pc_pos_map: Record<string, number[]>;
  pc_pos_map_compressed: string;
}

export interface VyperStorageLayout {
  [variableName: string]: { type: string; slot: number; n_slots: number };
}

/**
 * Vyper's `ir` output. Version 0.3.1 emits text LLL as a string; 0.3.2 and
 * later (including 0.3.10+ and 0.4.x) emit a structured IR tree where each
 * node is `{ <opcode>: [ ...args ] }` with number/string leaves. Modelled as
 * a recursive JSON value (only string/number/array/object are emitted in
 * practice) so consumers must narrow before reading into it.
 */
export type VyperIROutput =
  | string
  | number
  | boolean
  | null
  | VyperIROutput[]
  | { [key: string]: VyperIROutput };

export interface VyperOutputContract {
  abi: JsonFragment[];
  userdoc: Userdoc;
  devdoc: Devdoc;
  ir: VyperIROutput;
  layout?: {
    storage_layout: VyperStorageLayout;
  };
  evm: {
    bytecode: {
      object: string;
      opcodes: string;
      sourceMap?: VyperSourceMap;
    };
    deployedBytecode: {
      object: string;
      opcodes: string;
      sourceMap: string | VyperSourceMap;
      immutableReferences?: ImmutableReferences;
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
