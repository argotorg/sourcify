import { Abi } from 'abitype';
import {
  CompilationLanguage,
  CompilationTarget,
  CompiledContractCborAuxdata,
  StringMap,
} from '../Compilation/CompilationTypes';
import {
  ImmutableReferences,
  SoliditySettings,
  StorageLayout,
  Devdoc,
  LinkReferences,
  Metadata,
  Userdoc,
  VyperSettings,
  SolidityOutputSource,
  VyperOutputSource,
} from '@ethereum-sourcify/compilers-types';
import {
  SourcifyLibErrorParameters,
  SourcifyLibError,
} from '../SourcifyLibError';
import { Transformation, TransformationValues } from './Transformations';

export interface BytecodeMatchingResult {
  match: 'perfect' | 'partial' | null;
  libraryMap?: StringMap;
  populatedRecompiledBytecode: string;
  transformations: Transformation[];
  transformationValues: TransformationValues;
  message?: string;
}

export type VerificationErrorCode =
  | 'cannot_fetch_bytecode'
  | 'contract_not_deployed'
  | 'compiled_bytecode_is_zero'
  | 'extra_file_input_bug'
  | 'creation_bytecode_match_error'
  | 'no_match'
  | 'onchain_runtime_bytecode_not_available'
  | 'onchain_creation_bytecode_not_available'
  | 'bytecode_length_mismatch';

export class VerificationError extends SourcifyLibError {
  declare code: VerificationErrorCode;
  constructor(
    params: SourcifyLibErrorParameters & { code: VerificationErrorCode },
  ) {
    super(params);
  }
}

export enum SolidityBugType {
  NONE,
  IR_OUTPUT_ORDERING_BUG,
  EXTRA_FILE_INPUT_BUG,
}

export type VerificationStatus =
  | 'perfect'
  | 'partial'
  | 'extra-file-input-bug'
  | 'error'
  | null;

// When changing this type, be sure that it doesn't break the behavior
// of the server's storage services.
export interface VerificationExport {
  address: string;
  chainId: number;
  status: {
    runtimeMatch: VerificationStatus;
    creationMatch: VerificationStatus;
  };
  onchainRuntimeBytecode?: string;
  onchainCreationBytecode?: string;
  transformations: {
    runtime: {
      list: Transformation[];
      values: TransformationValues;
    };
    creation: {
      list: Transformation[];
      values: TransformationValues;
    };
  };
  deploymentInfo: {
    blockNumber?: number;
    txIndex?: number;
    deployer?: string;
    txHash?: string;
  };
  libraryMap: {
    runtime?: StringMap;
    creation?: StringMap;
  };
  compilation: {
    language: CompilationLanguage;
    compilationTarget: CompilationTarget;
    compilerVersion: string;
    sources: StringMap;
    compilerOutput: {
      // The export should not include the AST object to reduce the size
      sources?: Record<
        string,
        Pick<SolidityOutputSource, 'id'> | Pick<VyperOutputSource, 'id'>
      >;
    };
    contractCompilerOutput: {
      abi?: Abi;
      userdoc?: Userdoc;
      devdoc?: Devdoc;
      storageLayout?: StorageLayout;
      evm: {
        bytecode: {
          sourceMap?: string;
          linkReferences?: LinkReferences;
        };
        deployedBytecode: {
          sourceMap?: string;
          linkReferences?: LinkReferences;
        };
      };
    };
    runtimeBytecode?: string;
    creationBytecode?: string;
    runtimeBytecodeCborAuxdata?: CompiledContractCborAuxdata;
    creationBytecodeCborAuxdata?: CompiledContractCborAuxdata;
    immutableReferences?: ImmutableReferences;
    metadata?: Metadata;
    jsonInput: {
      settings: SoliditySettings | VyperSettings;
    };
    compilationTime?: number;
  };
}
