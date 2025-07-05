import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import {
  CompilationTarget,
  CompiledContractCborAuxdata,
  CompilationLanguage,
  StringMap,
  CompilationError,
  ISolidityCompiler,
  IVyperCompiler,
} from './CompilationTypes';
import {
  ImmutableReferences,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
  LinkReferences,
  Metadata,
  VyperJsonInput,
  VyperOutput,
  VyperOutputContract,
} from '@ethereum-sourcify/compilers-types';
import { logInfo, logSilly, logWarn } from '../logger';

export abstract class AbstractCompilation {
  /**
   * Constructor parameters
   */
  abstract compiler: ISolidityCompiler | IVyperCompiler;
  abstract compilerVersion: string;
  abstract compilationTarget: CompilationTarget;
  jsonInput: SolidityJsonInput | VyperJsonInput;

  protected _metadata?: Metadata;
  compilerOutput?: SolidityOutput | VyperOutput;
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

  constructor(jsonInput: SolidityJsonInput | VyperJsonInput) {
    this.jsonInput = structuredClone(jsonInput);
  }

  public async compileAndReturnCompilationTarget(
    forceEmscripten = false,
  ): Promise<SolidityOutputContract | VyperOutputContract> {
    const version = this.compilerVersion;

    const compilationStartTime = Date.now();
    logInfo('Compiling contract', {
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

  get contractCompilerOutput(): SolidityOutputContract | VyperOutputContract {
    if (!this.compilerOutput) {
      logWarn('Compiler output is undefined');
      throw new CompilationError({ code: 'no_compiler_output' });
    }
    if (
      !this.compilerOutput.contracts ||
      !this.compilerOutput.contracts[this.compilationTarget.path] ||
      !this.compilerOutput.contracts[this.compilationTarget.path][
        this.compilationTarget.name
      ]
    ) {
      logWarn('Contract not found in compiler output', {
        path: this.compilationTarget.path,
        name: this.compilationTarget.name,
      });
      throw new CompilationError({
        code: 'contract_not_found_in_compiler_output',
      });
    }
    return this.compilerOutput.contracts[this.compilationTarget.path][
      this.compilationTarget.name
    ];
  }

  get creationBytecode() {
    return `0x${this.contractCompilerOutput.evm.bytecode.object}`;
  }

  get runtimeBytecode() {
    return `0x${this.contractCompilerOutput.evm.deployedBytecode.object}`;
  }

  get metadata() {
    if (!this._metadata) {
      throw new CompilationError({ code: 'metadata_not_set' });
    }
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
