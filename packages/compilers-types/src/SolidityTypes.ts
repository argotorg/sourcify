import { Abi } from "abitype";
import { Devdoc, Userdoc, LinkReferences } from "./CompilationTypes";

interface File {
  keccak256?: string;
  urls?: string[];
  content: string;
}

export interface Sources {
  [key: string]: File;
}

interface YulDetails {
  stackAllocation: boolean;
  optimizerSteps?: string;
}

interface Details {
  peephole?: boolean;
  inliner?: boolean;
  jumpdestRemover?: boolean;
  orderLiterals?: boolean;
  deduplicate?: boolean;
  cse?: boolean;
  constantOptimizer?: boolean;
  yul?: boolean;
  yulDetails?: YulDetails;
}

interface Optimizer {
  enabled?: boolean;
  runs?: number;
  details?: Details;
}

enum DebugInfo {
  default = "default",
  strip = "strip",
  debug = "debug",
  verboseDebug = "verboseDebug",
}

interface Debug {
  revertStrings: DebugInfo;
  debugInfo?: string[];
}

interface SettingsMetadata {
  useLiteralContent?: boolean;
  bytecodeHash?: string;
  appendCBOR?: boolean;
}

interface MapContractAddress {
  [key: string]: string;
}

export interface Libraries {
  [key: string]: MapContractAddress;
}

interface OutputSelection {
  [key: string]: any;
}

interface Contracts {
  [key: string]: string[];
}

interface ModelChecker {
  contracts?: Contracts;
  divModNoSlacks?: boolean;
  engine?: string;
  invariants?: string[];
  showUnproved?: boolean;
  solvers?: string[];
  targets?: string[];
  timeout?: number;
}

export interface SoliditySettings {
  stopAfter?: string;
  remappings?: string[];
  optimizer?: Optimizer;
  evmVersion?: string;
  viaIR?: boolean;
  debug?: Debug;
  metadata?: SettingsMetadata;
  libraries?: Libraries;
  outputSelection: OutputSelection;
  modelChecker?: ModelChecker;
}

export interface SolidityJsonInput {
  language: string;
  sources: Sources;
  settings: SoliditySettings;
}

export interface SolidityOutputError {
  sourceLocation?: {
    file: string;
    start: number;
    end: number;
  };
  type: "TypeError" | "InternalCompilerError" | "Exception";
  component: "general" | "ewasm";
  severity: "error" | "warning";
  message: string;
  formattedMessage?: string;
  errorCode?: string;
}

interface SolidityOutputEvmBytecode {
  object: string;
  opcodes?: string;
  sourceMap?: string;
  linkReferences?: LinkReferences;
}

export interface ImmutableReferences {
  [key: string]: Array<{
    length: number;
    start: number;
  }>;
}

interface SolidityOutputEvmDeployedBytecode extends SolidityOutputEvmBytecode {
  immutableReferences?: ImmutableReferences;
}

export interface SolidityOutputSource {
  id: number;
  ast: any;
  legacyAST: any;
}

export interface SolidityOutputSources {
  [globalName: string]: SolidityOutputSource;
}

export interface StorageLayout {
  storage: Array<{
    astId: number;
    contract: string;
    label: string;
    offset: number;
    slot: string;
    type: string;
  }>;
  types: {
    [index: string]: {
      encoding: string;
      label: string;
      numberOfBytes: string;
    };
  };
}
export interface SolidityOutputContract {
  abi: Abi;
  metadata: string;
  userdoc?: Userdoc;
  devdoc?: Devdoc;
  ir?: string;
  irAst?: any;
  irOptimized?: string;
  irOptimizedAst?: any;
  storageLayout?: StorageLayout;
  evm: {
    assembly?: string;
    legacyAssembly?: any;
    bytecode: SolidityOutputEvmBytecode;
    deployedBytecode: SolidityOutputEvmDeployedBytecode;
    methodIdentifiers?: {
      [methodName: string]: string;
    };
    gasEstimates?: {
      creation: {
        codeDepositCost: string;
        executionCost: string;
        totalCost: string;
      };
      external: {
        [functionSignature: string]: string;
      };
      internal: {
        [functionSignature: string]: string;
      };
    };
  };
  ewasm?: {
    wast: string;
    wasm: string;
  };
}
export interface SolidityOutput {
  errors?: SolidityOutputError[];
  sources?: SolidityOutputSources;
  contracts: {
    [globalName: string]: {
      [contractName: string]: SolidityOutputContract;
    };
  };
}
