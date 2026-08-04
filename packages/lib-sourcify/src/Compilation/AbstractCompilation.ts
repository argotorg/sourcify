import type { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import type {
  CompilationTarget,
  CompiledContractCborAuxdata,
  CompilationLanguage,
  StringMap,
  ISolidityCompiler,
  IVyperCompiler,
  IFeCompiler,
} from './CompilationTypes';
import { CompilationError } from './CompilationTypes';
import type {
  ImmutableReferences,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
  LinkReferences,
  Metadata,
  VyperJsonInput,
  VyperOutput,
  VyperOutputContract,
  FeJsonInput,
  FeOutput,
  FeOutputContract,
} from '@ethereum-sourcify/compilers-types';
import { logDebug, logInfo, logSilly, logWarn } from '../logger';

function cleanCompilerVersion(version: string): string {
  // Remove non-numerical characters from the beginning of the version string
  return version.replace(/^[^\d]*/, '');
}

/**
 * Returns the compilation target's contract from a compiler output.
 * Use this instead of indexing `contracts` directly: in solcjs, for solidity
 * versions prior to 0.4.9, the contracts are stored without the source path as a key.
 */
export function findContractInCompilerOutput(
  compilerOutput: SolidityOutput | VyperOutput | FeOutput,
  compilationTarget: CompilationTarget,
): SolidityOutputContract | VyperOutputContract | FeOutputContract {
  const contract =
    compilerOutput.contracts?.['']?.[compilationTarget.name] ??
    compilerOutput.contracts?.[compilationTarget.path]?.[
      compilationTarget.name
    ];
  if (!contract) {
    logWarn('Contract not found in compiler output', {
      path: compilationTarget.path,
      name: compilationTarget.name,
    });
    throw new CompilationError({
      code: 'contract_not_found_in_compiler_output',
    });
  }
  return contract;
}

export abstract class AbstractCompilation {
  /**
   * Constructor parameters
   */
  abstract compiler: ISolidityCompiler | IVyperCompiler | IFeCompiler;
  compilerVersion: string;
  abstract compilationTarget: CompilationTarget;
  jsonInput: SolidityJsonInput | VyperJsonInput | FeJsonInput;

  protected _metadata?: Metadata;
  compilerOutput?: SolidityOutput | VyperOutput | FeOutput;
  compilationTime?: number;

  abstract auxdataStyle: AuxdataStyle;
  abstract language: CompilationLanguage;

  /** Marks the positions of the CborAuxdata parts in the bytecode */
  protected _creationBytecodeCborAuxdata?: CompiledContractCborAuxdata;
  protected _runtimeBytecodeCborAuxdata?: CompiledContractCborAuxdata;

  /**
   * Recompiles the contract with the specified compiler settings
   * @param forceEmscripten Whether to force using the WebAssembly binary for compilation (only for Solidity)
   */
  abstract compile(forceEmscripten?: boolean): Promise<void>;
  abstract generateCborAuxdataPositions(
    forceEmscripten?: boolean,
  ): Promise<void>;

  constructor(
    compilerVersion: string,
    jsonInput: SolidityJsonInput | VyperJsonInput | FeJsonInput,
  ) {
    this.compilerVersion = cleanCompilerVersion(compilerVersion);
    this.jsonInput = structuredClone(jsonInput);
  }

  public async compileAndReturnCompilationTarget(
    forceEmscripten = false,
  ): Promise<SolidityOutputContract | VyperOutputContract | FeOutputContract> {
    const version = this.compilerVersion;

    const compilationStartTime = Date.now();
    logDebug('Compiling contract', {
      version,
      contract: this.compilationTarget.name,
      path: this.compilationTarget.path,
      forceEmscripten,
    });
    logSilly('Compilation input', { solcJsonInput: this.jsonInput });
    try {
      this.compilerOutput = await this.compiler.compile(
        version,
        this.jsonInput as any,
        forceEmscripten,
      );
    } catch (e: any) {
      logWarn('Compiler error', {
        error: e.errors ? e.errors : e.message,
      });
      // Depending on the compiler implementation, the errors object could be undefined
      // In this case, we use the error message as a fallback
      // e.g. @ethreum-sourcify/compilers supports the errors object but web-solc does not
      throw new CompilationError({
        code: 'compiler_error',
        compilerErrors: e.errors,
        compilerErrorMessage: e.errors ? undefined : e.message,
      });
    }

    if (this.compilerOutput === undefined) {
      logWarn('Compiler error: compilerOutput is undefined');
      throw new CompilationError({ code: 'no_compiler_output' });
    }

    // We call contractCompilerOutput() before logging because it can throw an error
    const compilationTargetContract = this.contractCompilerOutput;

    // Some compilers don't output the deployedBytecode, e.g. Yul contracts compiled
    // with solc <0.6.9 or without a deployed subobject, or Solidity <0.1.3.
    // The rest of the verification flow relies on it being present, so fail here.
    if (!compilationTargetContract.evm.deployedBytecode) {
      logWarn('Runtime bytecode not found in compiler output', {
        path: this.compilationTarget.path,
        name: this.compilationTarget.name,
      });
      throw new CompilationError({
        code: 'runtime_bytecode_not_found_in_compiler_output',
      });
    }

    const compilationEndTime = Date.now();
    this.compilationTime = compilationEndTime - compilationStartTime;
    logSilly('Compilation output', { compilerOutput: this.compilerOutput });
    logInfo('Compiled contract', {
      version,
      contract: this.compilationTarget.name,
      path: this.compilationTarget.path,
      forceEmscripten,
      compilationDuration: `${this.compilationTime}ms`,
    });

    return compilationTargetContract;
  }

  get contractCompilerOutput():
    SolidityOutputContract | VyperOutputContract | FeOutputContract {
    if (!this.compilerOutput) {
      logWarn('Compiler output is undefined');
      throw new CompilationError({ code: 'no_compiler_output' });
    }
    return findContractInCompilerOutput(
      this.compilerOutput,
      this.compilationTarget,
    );
  }

  get creationBytecode() {
    return `0x${this.contractCompilerOutput.evm.bytecode.object}`;
  }

  get runtimeBytecode() {
    // The deployedBytecode presence is enforced in compileAndReturnCompilationTarget.
    // Its object can still be empty, e.g. for abstract contracts, in which case
    // verification fails with `compiled_bytecode_is_zero`.
    return `0x${this.contractCompilerOutput.evm.deployedBytecode.object || ''}`;
  }

  get metadata() {
    return this._metadata;
  }

  get sources() {
    return Object.keys(this.jsonInput.sources).reduce((acc, source) => {
      acc[source] = this.jsonInput.sources[source].content;
      return acc;
    }, {} as StringMap);
  }

  abstract get immutableReferences(): ImmutableReferences;
  abstract get runtimeLinkReferences(): LinkReferences;
  abstract get creationLinkReferences(): LinkReferences;

  get creationBytecodeCborAuxdata(): CompiledContractCborAuxdata {
    if (!this._creationBytecodeCborAuxdata) {
      throw new CompilationError({
        code: 'creation_bytecode_cbor_auxdata_not_set',
      });
    }
    return this._creationBytecodeCborAuxdata;
  }

  get runtimeBytecodeCborAuxdata(): CompiledContractCborAuxdata {
    if (!this._runtimeBytecodeCborAuxdata) {
      throw new CompilationError({
        code: 'runtime_bytecode_cbor_auxdata_not_set',
      });
    }
    return this._runtimeBytecodeCborAuxdata;
  }
}
