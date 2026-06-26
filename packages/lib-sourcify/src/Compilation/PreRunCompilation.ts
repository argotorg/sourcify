import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import {
  AbstractCompilation,
  getCompilerNameFromLanguage,
} from './AbstractCompilation';
import type {
  ImmutableReferences,
  LinkReferences,
  Metadata,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
  VyperJsonInput,
  VyperOutput,
  VyperOutputContract,
  FeJsonInput,
  FeOutput,
} from '@ethereum-sourcify/compilers-types';
import type {
  CompilationLanguage,
  CompilationTarget,
  CompiledContractCborAuxdata,
  ISolidityCompiler,
  IVyperCompiler,
  IFeCompiler,
} from './CompilationTypes';
import {
  returnAuxdataStyle,
  returnFixedVyperVersion,
} from './VyperCompilation';
import { isZkSolcCompilerVersion } from './ZkSolcCompilation';

export type Nullable<T> = T | null;

export class PreRunCompilation extends AbstractCompilation {
  public auxdataStyle: AuxdataStyle;
  // Vyper version is not semver compliant, so we need to handle it differently
  public compilerVersionCompatibleWithSemver?: string;
  public language: CompilationLanguage;
  // zksolc compiles with language "Solidity" but targets EraVM, which needs
  // ZKSYNC auxdata/bytecode handling instead of the standard Solidity path.
  public readonly isZkSolc: boolean;
  // Raw combined `zksolc:<v>;solc:<v>` version. Kept because the base
  // constructor strips the `zksolc:` prefix from `compilerVersion`.
  private readonly _zkSolcCompilerVersion?: string;

  public constructor(
    public compiler: ISolidityCompiler | IVyperCompiler | IFeCompiler,
    compilerVersion: string,
    jsonInput: SolidityJsonInput | VyperJsonInput | FeJsonInput,
    jsonOutput: SolidityOutput | VyperOutput | FeOutput,
    public compilationTarget: CompilationTarget,
    public _creationBytecodeCborAuxdata: CompiledContractCborAuxdata,
    public _runtimeBytecodeCborAuxdata: CompiledContractCborAuxdata,
  ) {
    super(compilerVersion, jsonInput);
    this.compilerOutput = jsonOutput;
    this.language = jsonInput.language as CompilationLanguage;
    // zksolc keeps the language as "Solidity"; detect it from the combined
    // `zksolc:<v>;solc:<v>` compiler version string.
    this.isZkSolc = isZkSolcCompilerVersion(compilerVersion);
    if (this.isZkSolc) {
      this._zkSolcCompilerVersion = compilerVersion;
    }
    switch (this.language) {
      case 'Solidity': {
        if (this.isZkSolc) {
          // EraVM auxdata layout. zksolc metadata is not a standard solc
          // metadata JSON, so it is restored via setMetadata() from the stored
          // candidate instead of parsing it here.
          this.auxdataStyle = AuxdataStyle.ZKSYNC;
          break;
        }
        this.auxdataStyle = AuxdataStyle.SOLIDITY;
        const contractOutput = jsonOutput.contracts[
          this.compilationTarget.path
        ][this.compilationTarget.name] as SolidityOutputContract;
        if (contractOutput.metadata) {
          this._metadata = JSON.parse(contractOutput.metadata.trim());
        }
        break;
      }
      case 'Vyper': {
        // Vyper beta and rc versions are not semver compliant, so we need to handle them differently
        this.compilerVersionCompatibleWithSemver = returnFixedVyperVersion(
          this.compilerVersion,
        );

        // Vyper version support for auxdata is different for each version
        this.auxdataStyle = returnAuxdataStyle(
          this.compilerVersionCompatibleWithSemver,
        );
        break;
      }
      case 'Fe': {
        this.auxdataStyle = AuxdataStyle.FE;
        break;
      }
      default:
        throw new Error(`Unsupported language: ${this.language}`);
    }
  }

  get runtimeBytecode() {
    if (this.isZkSolc) {
      // EraVM exposes a single bytecode artifact; there is no deployedBytecode
      // split, so the runtime bytecode is read from evm.bytecode.
      return `0x${
        (this.contractCompilerOutput as SolidityOutputContract).evm.bytecode
          .object
      }`;
    }
    return super.runtimeBytecode;
  }

  // PreRunCompilation reconstructs any language from stored data, so unlike the
  // single-compiler compilations it maps the language to a compiler name (and
  // reports zksolc when the stored version is a zksolc toolchain string).
  public get compilerName(): string {
    return this.isZkSolc
      ? 'zksolc'
      : getCompilerNameFromLanguage(this.language);
  }

  public get resolvedCompilerVersion(): string {
    return this.isZkSolc && this._zkSolcCompilerVersion
      ? this._zkSolcCompilerVersion
      : super.resolvedCompilerVersion;
  }

  public async generateCborAuxdataPositions() {
    return;
  }

  public async compile() {
    return;
  }

  protected async runCompiler(): Promise<
    SolidityOutput | VyperOutput | FeOutput
  > {
    return this.compilerOutput!;
  }

  get immutableReferences(): ImmutableReferences {
    switch (this.language) {
      case 'Yul':
      case 'Solidity': {
        const compilationTarget = this
          .contractCompilerOutput as SolidityOutputContract;
        if (this.isZkSolc) {
          // EraVM may not emit a deployedBytecode; fall back to bytecode.
          const evm = compilationTarget.evm as any;
          return (
            evm.deployedBytecode?.immutableReferences ||
            evm.bytecode.immutableReferences ||
            {}
          );
        }
        return compilationTarget.evm.deployedBytecode.immutableReferences || {};
      }
      case 'Vyper': {
        const compilationTarget = this
          .contractCompilerOutput as VyperOutputContract;
        return compilationTarget.evm.deployedBytecode.immutableReferences || {};
      }
      case 'Fe':
        return {};
    }
  }

  get runtimeLinkReferences(): LinkReferences {
    switch (this.language) {
      case 'Yul':
      case 'Solidity': {
        const compilationTarget = this
          .contractCompilerOutput as SolidityOutputContract;
        if (this.isZkSolc) {
          // EraVM link references live on bytecode, not deployedBytecode.
          return compilationTarget.evm.bytecode.linkReferences || {};
        }
        return compilationTarget.evm.deployedBytecode.linkReferences || {};
      }
      case 'Vyper':
      case 'Fe':
        return {};
    }
  }

  get creationLinkReferences(): LinkReferences {
    switch (this.language) {
      case 'Yul':
      case 'Solidity': {
        const compilationTarget = this
          .contractCompilerOutput as SolidityOutputContract;
        return compilationTarget.evm.bytecode.linkReferences || {};
      }
      case 'Vyper':
      case 'Fe':
        return {};
    }
  }

  setMetadata(metadata: Metadata) {
    this._metadata = metadata;
  }
}
