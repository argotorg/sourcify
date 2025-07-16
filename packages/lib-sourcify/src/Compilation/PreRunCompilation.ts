import { AuxdataStyle, decode } from '@ethereum-sourcify/bytecode-utils';
import { AbstractCompilation } from './AbstractCompilation';
import {
  ImmutableReferences,
  LinkReferences,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
  VyperJsonInput,
  VyperOutput,
} from '@ethereum-sourcify/compilers-types';
import {
  CompilationError,
  CompilationLanguage,
  CompilationTarget,
  CompiledContractCborAuxdata,
  ISolidityCompiler,
  IVyperCompiler,
} from './CompilationTypes';
import { logWarn } from '../logger';
import semver, { gte } from 'semver';

export type Nullable<T> = T | null;

export class PreRunCompilation extends AbstractCompilation {
  public auxdataStyle: AuxdataStyle;
  // Vyper version is not semver compliant, so we need to handle it differently
  public compilerVersionCompatibleWithSemver?: string;
  public language: CompilationLanguage;

  public constructor(
    public compiler: ISolidityCompiler | IVyperCompiler,
    language: 'solidity' | 'vyper',
    public compilerVersion: string,
    jsonInput: SolidityJsonInput | VyperJsonInput,
    jsonOutput: SolidityOutput | VyperOutput,
    public compilationTarget: CompilationTarget,
    public _creationBytecodeCborAuxdata: CompiledContractCborAuxdata,
    public _runtimeBytecodeCborAuxdata: CompiledContractCborAuxdata,
  ) {
    super(jsonInput);
    this.compilerOutput = jsonOutput;
    switch (language) {
      case 'solidity': {
        this.language = 'Solidity';
        this.auxdataStyle = AuxdataStyle.SOLIDITY;
        const contractOutput = jsonOutput.contracts[
          this.compilationTarget.path
        ][this.compilationTarget.name] as SolidityOutputContract;
        this._metadata = JSON.parse(contractOutput.metadata.trim());
        break;
      }
      case 'vyper': {
        this.language = 'Vyper';
        if (semver.valid(this.compilerVersion)) {
          this.compilerVersionCompatibleWithSemver = this.compilerVersion;
        } else {
          // Check for beta or release candidate versions
          if (this.compilerVersion.match(/\d+\.\d+\.\d+(b\d+|rc\d+)/)) {
            this.compilerVersionCompatibleWithSemver = `${this.compilerVersion
              .split('+')[0]
              .replace(
                /(b\d+|rc\d+)$/,
                '',
              )}+${this.compilerVersion.split('+')[1]}`;
          } else {
            throw new CompilationError({ code: 'invalid_compiler_version' });
          }
        }

        // Vyper version support for auxdata is different for each version
        if (semver.lt(this.compilerVersionCompatibleWithSemver, '0.3.5')) {
          this.auxdataStyle = AuxdataStyle.VYPER_LT_0_3_5;
        } else if (
          semver.lt(this.compilerVersionCompatibleWithSemver, '0.3.10')
        ) {
          this.auxdataStyle = AuxdataStyle.VYPER_LT_0_3_10;
        } else {
          this.auxdataStyle = AuxdataStyle.VYPER;
        }
        break;
      }
      default:
        throw new Error(`Unsupported language: ${language}`);
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
      case 'Solidity': {
        const compilationTarget = this
          .contractCompilerOutput as SolidityOutputContract;
        return compilationTarget.evm.deployedBytecode.immutableReferences || {};
      }
      case 'Vyper': {
        let immutableReferences = {};
        if (
          this.compilerVersionCompatibleWithSemver &&
          gte(this.compilerVersionCompatibleWithSemver, '0.3.10')
        ) {
          try {
            const { immutableSize } = decode(
              this.creationBytecode,
              this.auxdataStyle,
            );
            if (immutableSize) {
              immutableReferences = {
                '0': [
                  {
                    length: immutableSize,
                    start: this.runtimeBytecode.substring(2).length / 2,
                  },
                ],
              };
            }
          } catch (e) {
            logWarn('Cannot decode vyper contract bytecode', {
              creationBytecode: this.creationBytecode,
            });
          }
        }
        return immutableReferences;
      }
    }
  }

  get runtimeLinkReferences(): LinkReferences {
    switch (this.language) {
      case 'Solidity': {
        const compilationTarget = this
          .contractCompilerOutput as SolidityOutputContract;
        return compilationTarget.evm.deployedBytecode.linkReferences || {};
      }
      case 'Vyper':
        return {};
    }
  }

  get creationLinkReferences(): LinkReferences {
    switch (this.language) {
      case 'Solidity': {
        const compilationTarget = this
          .contractCompilerOutput as SolidityOutputContract;
        return compilationTarget.evm.bytecode.linkReferences || {};
      }
      case 'Vyper':
        return {};
    }
  }
}
