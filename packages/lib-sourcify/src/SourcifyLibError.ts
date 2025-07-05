import { OutputError } from '@ethereum-sourcify/compilers-types';
import { CompilationErrorCode } from './Compilation/CompilationTypes';
import { ValidationErrorCode } from './Validation/ValidationTypes';
import { VerificationErrorCode } from './Verification/VerificationTypes';

export type SourcifyLibErrorCode =
  | ValidationErrorCode
  | CompilationErrorCode
  | VerificationErrorCode;

interface SourcifyLibErrorDataRequired {
  chainId: string;
  address: string;
  missingSources: string[];
  invalidSources: string[];
  compilationTargets: string[];
  compilerErrorMessage?: string;
  compilerErrors?: OutputError[];
}

export type SourcifyLibErrorData = Partial<SourcifyLibErrorDataRequired>;

// This structure gives type safety to the error parameters depending on the code.
export type SourcifyLibErrorParameters =
  | {
      code: Exclude<
        SourcifyLibErrorCode,
        | 'missing_source'
        | 'missing_or_invalid_source'
        | 'invalid_compilation_target'
        | 'cannot_fetch_bytecode'
        | 'contract_not_deployed'
        | 'compiler_error'
      >;
    }
  | ({
      code: 'missing_source';
    } & Pick<SourcifyLibErrorDataRequired, 'missingSources'>)
  | ({
      code: 'missing_or_invalid_source';
    } & Pick<SourcifyLibErrorDataRequired, 'missingSources' | 'invalidSources'>)
  | ({
      code: 'invalid_compilation_target';
    } & Pick<SourcifyLibErrorDataRequired, 'compilationTargets'>)
  | ({
      code: 'cannot_fetch_bytecode' | 'contract_not_deployed';
    } & Pick<SourcifyLibErrorDataRequired, 'address' | 'chainId'>)
  | ({
      code: 'compiler_error';
    } & Pick<
      SourcifyLibErrorDataRequired,
      'compilerErrorMessage' | 'compilerErrors'
    >);

export class SourcifyLibError extends Error {
  public code: SourcifyLibErrorCode;
  public data: SourcifyLibErrorData;
  constructor(params: SourcifyLibErrorParameters) {
    super(getErrorMessageFromCode(params));
    const { code, ...data } = params;
    this.code = code;
    this.data = data;
  }
}

export function getErrorMessageFromCode(params: SourcifyLibErrorParameters) {
  switch (params.code) {
    // Validation errors
    case 'missing_source':
      return `One or more sources are mentioned in the metadata but are not provided or could not be fetched. Missing sources: ${params.missingSources.join(', ')}`;
    case 'missing_or_invalid_source':
      return `One or more sources are mentioned in the metadata but are missing or are invalid. Missing sources: ${params.missingSources.join(', ')}; Invalid sources: ${params.invalidSources.join(', ')}`;
    case 'invalid_compilation_target':
      return `More than one compilationTarget in the metadata, or the compilationTarget is invalid. compilationTarget: ${params.compilationTargets.join(', ')}`;
    // Compilation errors
    case 'compiler_error':
      return `Compiler error. ${params.compilerErrors ? JSON.stringify(params.compilerErrors) : params.compilerErrorMessage}`;
    case 'no_compiler_output':
      return 'Compiler output is undefined.';
    case 'contract_not_found_in_compiler_output':
      return 'Contract not found in compiler output.';
    case 'metadata_not_set':
      return 'No metadata on compilation object.';
    case 'creation_bytecode_cbor_auxdata_not_set':
      return 'No creation bytecode cbor auxdata on compilation object.';
    case 'runtime_bytecode_cbor_auxdata_not_set':
      return 'No runtime bytecode cbor auxdata on compilation object.';
    case 'invalid_compiler_version':
      return 'Invalid compiler version.';
    case 'cannot_generate_cbor_auxdata_positions':
      return 'Cannot generate cbor auxdata positions.';
    // Verification errors
    case 'cannot_fetch_bytecode':
      return `Cannot fetch bytecode for chain #${params.chainId} and address ${params.address}.`;
    case 'contract_not_deployed':
      return `Chain #${params.chainId} does not have a contract deployed at ${params.address}.`;
    case 'compiled_bytecode_is_zero':
      return 'The compiled contract bytecode is "0x". Are you trying to verify an abstract contract?';
    case 'extra_file_input_bug':
      return "It seems your contract's metadata hashes match but not the bytecodes. If you are verifying via metadata.json, use the original full standard JSON input file that has all files including those not needed by this contract. See the issue for more information: https://github.com/ethereum/sourcify/issues/618";
    case 'bytecode_length_mismatch':
      return "The recompiled bytecode length doesn't match the onchain bytecode length.";
    case 'no_match':
      return "The deployed and recompiled bytecode don't match.";
    case 'onchain_runtime_bytecode_not_available':
      return 'Onchain runtime bytecode not available.';
    case 'onchain_creation_bytecode_not_available':
      return 'Onchain creation bytecode not available.';
    // Unknown error
    default:
      return 'Unknown error.';
  }
}
