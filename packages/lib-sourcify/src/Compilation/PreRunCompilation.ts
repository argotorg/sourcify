import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import { AbstractCompilation } from './AbstractCompilation';
import type {
  ImmutableReferences,
  LinkReferences,
  Metadata,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
  VyperJsonInput,
  VyperOutput,
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
  returnImmutableReferences,
} from './VyperCompilation';

export type Nullable<T> = T | null;

export class PreRunCompilation extends AbstractCompilation {
  public auxdataStyle: AuxdataStyle;
  // Vyper version is not semver compliant, so we need to handle it differently
  public compilerVersionCompatibleWithSemver?: string;
  public language: CompilationLanguage;

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
    switch (this.language) {
      case 'Solidity': {
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

  public async generateCborAuxdataPositions() {
    return;
  }

  public async compile() {
    return;
  }

  get immutableReferences(): ImmutableReferences {
    switch (this.language) {
      case 'Yul':
      case 'Solidity': {
        const compilationTarget = this
          .contractCompilerOutput as SolidityOutputContract;
        return compilationTarget.evm.deployedBytecode.immutableReferences || {};
      }
      case 'Vyper': {
        return returnImmutableReferences(
          this.compilerVersionCompatibleWithSemver!,
          this.creationBytecode,
          this.runtimeBytecode,
          this.auxdataStyle,
        );
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
