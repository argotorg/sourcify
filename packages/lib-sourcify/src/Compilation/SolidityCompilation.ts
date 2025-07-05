import { AuxdataStyle, splitAuxdata } from '@ethereum-sourcify/bytecode-utils';
import { AbstractCompilation } from './AbstractCompilation';
import {
  ImmutableReferences,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
  LinkReferences,
} from '@ethereum-sourcify/compilers-types';
import {
  CompilationError,
  CompilationLanguage,
  CompilationTarget,
  ISolidityCompiler,
} from './CompilationTypes';
import {
  findAuxdataPositions,
  findAuxdatasInLegacyAssembly,
} from './auxdataUtils';
import { logWarn } from '../logger';

/**
 * Abstraction of a solidity compilation
 */
export class SolidityCompilation extends AbstractCompilation {
  public language: CompilationLanguage = 'Solidity';
  // Use declare to override AbstractCompilation's types to target Solidity types
  declare jsonInput: SolidityJsonInput;
  declare compilerOutput?: SolidityOutput;
  declare compileAndReturnCompilationTarget: (
    forceEmscripten: boolean,
  ) => Promise<SolidityOutputContract>;

  // Specify the auxdata style, used for extracting the auxdata from the compiler output
  readonly auxdataStyle: AuxdataStyle.SOLIDITY = AuxdataStyle.SOLIDITY;

  public constructor(
    public compiler: ISolidityCompiler,
    public compilerVersion: string,
    jsonInput: SolidityJsonInput,
    public compilationTarget: CompilationTarget,
  ) {
    super(jsonInput);
    this.initSolidityJsonInput();
  }

  initSolidityJsonInput() {
    this.jsonInput.settings.outputSelection = {
      '*': {
        '*': [
          'abi',
          'devdoc',
          'userdoc',
          'storageLayout',
          'evm.legacyAssembly',
          'evm.bytecode.object',
          'evm.bytecode.sourceMap',
          'evm.bytecode.linkReferences',
          'evm.bytecode.generatedSources',
          'evm.deployedBytecode.object',
          'evm.deployedBytecode.sourceMap',
          'evm.deployedBytecode.linkReferences',
          'evm.deployedBytecode.immutableReferences',
          'metadata',
        ],
      },
    };
  }

  /** Generates an edited contract with a space at the end of each source file to create a different source file hash and consequently a different metadata hash.
   * This differenence is then used to determine the positions of the auxdata in the raw bytecode.
   */
  public async generateEditedContract(compilerSettings: {
    version: string;
    solcJsonInput: SolidityJsonInput;
    forceEmscripten: boolean;
  }) {
    const newCompilerSettings: {
      version: string;
      solcJsonInput: SolidityJsonInput;
      forceEmscripten: boolean;
    } = JSON.parse(JSON.stringify(compilerSettings));
    Object.values(newCompilerSettings.solcJsonInput.sources).forEach(
      (source) => (source.content += ' '),
    );
    return await this.compiler.compile(
      newCompilerSettings.version,
      newCompilerSettings.solcJsonInput,
      newCompilerSettings.forceEmscripten,
    );
  }

  /**
   * Finds the positions of the auxdata in the runtime and creation bytecodes.
   * Saves the CborAuxdata position (offset) and value in the runtime- and creationBytecodeCborAuxdata fields.
   */
  public async generateCborAuxdataPositions(forceEmscripten = false) {
    try {
      // Auxdata array extracted from the compiler's `legacyAssembly` field
      const auxdatasFromCompilerOutput = findAuxdatasInLegacyAssembly(
        (this.contractCompilerOutput as SolidityOutputContract).evm
          .legacyAssembly,
      );

      // Case: there is not auxadata
      if (auxdatasFromCompilerOutput.length === 0) {
        this._creationBytecodeCborAuxdata = {};
        this._runtimeBytecodeCborAuxdata = {};
        return;
      }

      // Case: there is only one auxdata, no need to recompile if we find both runtime and creation auxdata at the end of the bytecode (creation auxdata can be in a different place)
      if (auxdatasFromCompilerOutput.length === 1) {
        // Extract the auxdata from the end of the recompiled runtime bytecode
        const [, runtimeAuxdataCbor, runtimeCborLengthHex] = splitAuxdata(
          this.runtimeBytecode,
          this.auxdataStyle,
        );

        if (!runtimeAuxdataCbor) {
          throw new Error('runtimeAuxdataCbor is undefined');
        }

        const auxdataFromRawRuntimeBytecode = `${runtimeAuxdataCbor}${runtimeCborLengthHex}`;

        // we divide by 2 because we store the length in bytes (without 0x)
        this._runtimeBytecodeCborAuxdata = {
          '1': {
            offset:
              this.runtimeBytecode.substring(2).length / 2 -
              parseInt(runtimeCborLengthHex, 16) -
              2, // bytecode has 2 bytes of cbor length prefix at the end
            value: `0x${auxdataFromRawRuntimeBytecode}`,
          },
        };

        // Try to extract the auxdata from the end of the recompiled creation bytecode
        const [, creationAuxdataCbor, creationCborLengthHex] = splitAuxdata(
          this.creationBytecode,
          this.auxdataStyle,
        );

        // If we can find the auxdata at the end of the bytecode return; otherwise continue with `generateEditedContract`
        if (creationAuxdataCbor) {
          const auxdataFromRawCreationBytecode = `${creationAuxdataCbor}${creationCborLengthHex}`;
          // we divide by 2 because we store the length in bytes (without 0x)
          this._creationBytecodeCborAuxdata = {
            '1': {
              offset:
                this.creationBytecode.substring(2).length / 2 -
                parseInt(creationCborLengthHex, 16) -
                2, // bytecode has 2 bytes of cbor length prefix at the end
              value: `0x${auxdataFromRawCreationBytecode}`,
            },
          };
          return;
        }
      }

      // Case: multiple auxdatas or creation auxdata not found at the end of the bytecode,
      // we need to recompile with a slightly edited file to check the differences
      const editedContractCompilerOutput = await this.generateEditedContract({
        version: this.compilerVersion,
        solcJsonInput: this.jsonInput,
        forceEmscripten,
      });
      const editedContract =
        editedContractCompilerOutput.contracts[this.compilationTarget.path][
          this.compilationTarget.name
        ];

      const editedContractAuxdatasFromCompilerOutput =
        findAuxdatasInLegacyAssembly(editedContract.evm.legacyAssembly);

      // Potentially we already found runtimeBytecodeCborAuxdata in the case of creation auxdata not found at the end of the bytecode
      // so no need to call `findAuxdataPositions`
      if (this._runtimeBytecodeCborAuxdata === undefined) {
        this._runtimeBytecodeCborAuxdata = findAuxdataPositions(
          this.runtimeBytecode,
          `0x${editedContract.evm.deployedBytecode.object}`,
          auxdatasFromCompilerOutput,
          editedContractAuxdatasFromCompilerOutput,
        );
      }

      this._creationBytecodeCborAuxdata = findAuxdataPositions(
        this.creationBytecode,
        `0x${editedContract.evm.bytecode.object}`,
        auxdatasFromCompilerOutput,
        editedContractAuxdatasFromCompilerOutput,
      );
    } catch (error) {
      logWarn('Cannot generate cbor auxdata positions', {
        error,
      });
      throw new CompilationError({
        code: 'cannot_generate_cbor_auxdata_positions',
      });
    }
  }

  public async compile(forceEmscripten = false) {
    const contract =
      await this.compileAndReturnCompilationTarget(forceEmscripten);
    this._metadata = JSON.parse(contract.metadata.trim());
  }

  get immutableReferences(): ImmutableReferences {
    const compilationTarget = this
      .contractCompilerOutput as SolidityOutputContract;
    return compilationTarget.evm.deployedBytecode.immutableReferences || {};
  }

  get runtimeLinkReferences(): LinkReferences {
    const compilationTarget = this
      .contractCompilerOutput as SolidityOutputContract;
    return compilationTarget.evm.deployedBytecode.linkReferences || {};
  }

  get creationLinkReferences(): LinkReferences {
    const compilationTarget = this
      .contractCompilerOutput as SolidityOutputContract;
    return compilationTarget.evm.bytecode.linkReferences || {};
  }
}
