import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import { AbstractCompilation } from './AbstractCompilation';
import type {
  FeJsonInput,
  FeOutput,
  FeOutputContract,
  ImmutableReferences,
  LinkReferences,
} from '@ethereum-sourcify/compilers-types';
import type {
  CompilationLanguage,
  CompilationTarget,
  IFeCompiler,
} from './CompilationTypes';

/**
 * Abstraction of a Fe compilation.
 *
 * Fe has no CBOR-encoded metadata/auxdata in its bytecode, so verification
 * is always partial (bytecode match only, no exact/perfect match).
 */
export class FeCompilation extends AbstractCompilation {
  public language: CompilationLanguage = 'Fe';
  // Use declare to override AbstractCompilation's types to target Fe types
  declare jsonInput: FeJsonInput;
  declare compilerOutput?: FeOutput;
  declare compileAndReturnCompilationTarget: (
    forceEmscripten: boolean,
  ) => Promise<FeOutputContract>;

  // Fe has no CBOR metadata — AuxdataStyle.FE is a no-op in splitAuxdata
  public auxdataStyle = AuxdataStyle.FE;

  public constructor(
    public compiler: IFeCompiler,
    compilerVersion: string,
    jsonInput: FeJsonInput,
    public compilationTarget: CompilationTarget,
  ) {
    super(compilerVersion, jsonInput);
  }

  public async compile() {
    await this.compileAndReturnCompilationTarget(false);
  }

  /**
   * Fe has no CBOR metadata — set both auxdata positions to empty.
   */
  public async generateCborAuxdataPositions() {
    this._creationBytecodeCborAuxdata = {};
    this._runtimeBytecodeCborAuxdata = {};
  }

  get immutableReferences(): ImmutableReferences {
    // Fe has no immutables
    return {};
  }

  get runtimeLinkReferences(): LinkReferences {
    // Fe has no libraries
    return {};
  }

  get creationLinkReferences(): LinkReferences {
    // Fe has no libraries
    return {};
  }

  // Override to NOT add 0x prefix — Fe outputs raw hex strings without prefix
  get creationBytecode() {
    return this.contractCompilerOutput.evm.bytecode.object;
  }

  get runtimeBytecode() {
    return this.contractCompilerOutput.evm.deployedBytecode.object;
  }
}
