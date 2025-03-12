import { AbstractCompilation } from '../Compilation/AbstractCompilation';
import { logDebug, logInfo, logWarn } from '../logger';
import SourcifyChain from '../SourcifyChain/SourcifyChain';
import { lt } from 'semver';
import {
  splitAuxdata,
  AuxdataStyle,
  decode as decodeBytecode,
  SolidityDecodedObject,
} from '@ethereum-sourcify/bytecode-utils';
import { SolidityCompilation } from '../Compilation/SolidityCompilation';
import { VyperCompilation } from '../Compilation/VyperCompilation';
import { StringMap } from '../Compilation/CompilationTypes';

import {
  extractAuxdataTransformation,
  extractCallProtectionTransformation,
  extractConstructorArgumentsTransformation,
  extractImmutablesTransformation,
  extractLibrariesTransformation,
  Transformation,
  TransformationValues,
} from './Transformations';
import {
  BytecodeMatchingResult,
  SolidityBugType,
  VerificationError,
  VerificationStatus,
} from './VerificationTypes';
import { SoliditySettings } from '../Compilation/SolidityTypes';

export class Verification {
  // Bytecodes
  private _onchainRuntimeBytecode?: string;
  private _onchainCreationBytecode?: string;

  // Transformations
  private runtimeTransformations: Transformation[] = [];
  private creationTransformations: Transformation[] = [];
  private runtimeTransformationValues: TransformationValues = {};
  private creationTransformationValues: TransformationValues = {};

  // Match status
  private runtimeMatch: VerificationStatus = null;
  private creationMatch: VerificationStatus = null;
  private runtimeLibraryMap?: StringMap;
  private creationLibraryMap?: StringMap;
  private blockNumber?: number;
  private txIndex?: number;
  private deployer?: string;

  constructor(
    public compilation: AbstractCompilation,
    private sourcifyChain: SourcifyChain,
    public address: string,
    private creatorTxHash?: string,
  ) {}

  async verify({
    forceEmscripten = false,
  }: { forceEmscripten?: boolean } = {}): Promise<void> {
    logInfo('Verifying contract', {
      address: this.address,
      chainId: this.sourcifyChain.chainId,
    });

    try {
      this._onchainRuntimeBytecode = await this.sourcifyChain.getBytecode(
        this.address,
      );
    } catch (e: any) {
      throw new VerificationError(
        `Cannot fetch bytecode for chain #${this.sourcifyChain.chainId} and address ${this.address}`,
        'cant_fetch_bytecode',
      );
    }

    if (this.onchainRuntimeBytecode === '0x') {
      throw new VerificationError(
        `Chain #${this.sourcifyChain.chainId} does not have a contract deployed at ${this.address}.`,
        'contract_not_deployed',
      );
    }

    // Compile the contract
    await this.compilation.compile(forceEmscripten);

    const compiledRuntimeBytecode = this.compilation.runtimeBytecode;
    const compiledCreationBytecode = this.compilation.creationBytecode;

    if (compiledRuntimeBytecode === '0x' || compiledCreationBytecode === '0x') {
      throw new VerificationError(
        `The compiled contract bytecode is "0x". Are you trying to verify an abstract contract?`,
        'compiled_bytecode_is_zero',
      );
    }

    // Early bytecode length check:
    // - For Solidity: bytecode lengths must match exactly
    // - For Vyper: recompiled bytecode must not be longer than onchain as Vyper appends immutables at deployment
    // We cannot do an early check for creation bytecode length mismatch because
    // creation bytecode length can differ due to constructor arguments being appended at the end
    if (
      (this.compilation instanceof SolidityCompilation &&
        compiledRuntimeBytecode.length !==
          this.onchainRuntimeBytecode.length) ||
      (this.compilation instanceof VyperCompilation &&
        compiledRuntimeBytecode.length > this.onchainRuntimeBytecode.length)
    ) {
      // Before throwing the bytecode length mismatch error, check for Solidity extra file input bug
      if (this.compilation instanceof SolidityCompilation) {
        const solidityBugType = this.handleSolidityExtraFileInputBug();
        if (solidityBugType === SolidityBugType.EXTRA_FILE_INPUT_BUG) {
          throw new VerificationError(
            "It seems your contract's metadata hashes match but not the bytecodes. If you are verifying via metadata.json, use the original full standard JSON input file that has all files including those not needed by this contract. See the issue for more information: https://github.com/ethereum/sourcify/issues/618",
            'extra_file_input_bug',
          );
        }
      }
      throw new VerificationError(
        `The recompiled bytecode length doesn't match the onchain bytecode length.`,
        'bytecode_length_mismatch',
      );
    }

    // We need to manually generate the auxdata positions because they are not automatically produced during compilation
    // Read more: https://docs.sourcify.dev/blog/finding-auxdatas-in-bytecode/
    try {
      await this.compilation.generateCborAuxdataPositions();
    } catch {
      // Continue verification even if cbor auxdata positions cannot be generated
      // In case of an auxdata transformation, the error will be thrown later
    }

    // Try to match onchain runtime bytecode with compiled runtime bytecode
    try {
      logDebug('Matching with runtime bytecode', {
        chain: this.sourcifyChain.chainId,
        address: this.address,
      });
      await this.matchWithRuntimeBytecode();
    } catch (e: any) {
      logWarn('Error matching with runtime bytecode', {
        chain: this.sourcifyChain.chainId,
        address: this.address,
        error: e.message,
      });
    }

    if (
      this.compilation instanceof SolidityCompilation &&
      this.runtimeMatch === null
    ) {
      // Handle Solidity extra file input bug
      let solidityBugType = this.handleSolidityExtraFileInputBug();
      if (solidityBugType === SolidityBugType.EXTRA_FILE_INPUT_BUG) {
        throw new VerificationError(
          "It seems your contract's metadata hashes match but not the bytecodes. If you are verifying via metadata.json, use the original full standard JSON input file that has all files including those not needed by this contract. See the issue for more information: https://github.com/ethereum/sourcify/issues/618",
          'extra_file_input_bug',
        );
      }

      // Handle Solidity IR output ordering bug
      solidityBugType =
        await this.handleSolidityIROutputOrderingBug(forceEmscripten);
      if (solidityBugType === SolidityBugType.IR_OUTPUT_ORDERING_BUG) {
        return await this.verify({ forceEmscripten: true });
      }
    }

    // Try to match onchain creation bytecode with compiled creation bytecode
    if (this.creatorTxHash) {
      try {
        logDebug('Matching with creation tx', {
          chain: this.sourcifyChain.chainId,
          address: this.address,
          creatorTxHash: this.creatorTxHash,
        });

        // Get creation transaction data
        const creatorTx = await this.sourcifyChain.getTx(this.creatorTxHash);
        this.blockNumber = creatorTx.blockNumber || undefined;
        this.deployer = creatorTx.from;

        const { creationBytecode, txReceipt } =
          await this.sourcifyChain.getContractCreationBytecodeAndReceipt(
            this.address,
            this.creatorTxHash,
            creatorTx,
          );
        this._onchainCreationBytecode = creationBytecode;
        this.txIndex = txReceipt.index;

        await this.matchWithCreationTx();
      } catch (e: any) {
        logWarn('Error matching with creation tx', {
          chain: this.sourcifyChain.chainId,
          address: this.address,
          creatorTxHash: this.creatorTxHash,
          error: e.message,
        });
        this.creatorTxHash = undefined;
      }
    }

    if (this.creationMatch !== null || this.runtimeMatch !== null) {
      logInfo('Verified contract', {
        address: this.address,
        chainId: this.sourcifyChain.chainId,
        runtimeMatch: this.runtimeMatch,
        creationMatch: this.creationMatch,
      });
      return;
    }

    throw new VerificationError(
      "The deployed and recompiled bytecode don't match.",
      'no_match',
    );
  }

  handleSolidityExtraFileInputBug(): SolidityBugType {
    // Case when extra unused files in compiler input cause different bytecode
    // See issues:
    //   https://github.com/ethereum/sourcify/issues/618
    //   https://github.com/ethereum/solidity/issues/14250
    //   https://github.com/ethereum/solidity/issues/14494
    const [, deployedAuxdata] = splitAuxdata(
      this.onchainRuntimeBytecode,
      AuxdataStyle.SOLIDITY,
    );
    const [, recompiledAuxdata] = splitAuxdata(
      this.compilation.runtimeBytecode,
      AuxdataStyle.SOLIDITY,
    );
    // Metadata hashes match but bytecodes don't match.
    if (
      deployedAuxdata === recompiledAuxdata &&
      (this.compilation.jsonInput.settings as SoliditySettings).optimizer
        ?.enabled
    ) {
      return SolidityBugType.EXTRA_FILE_INPUT_BUG;
    }
    return SolidityBugType.NONE;
  }

  async handleSolidityIROutputOrderingBug(
    forceEmscripten: boolean,
  ): Promise<SolidityBugType> {
    // Handle Solidity specific verification bug cases
    const settings = this.compilation.jsonInput.settings as SoliditySettings;

    // Handle when <0.8.21 and with viaIR and with optimizer disabled
    // See issues:
    //   https://github.com/ethereum/sourcify/issues/1088
    if (
      !forceEmscripten && // Enter this case only if we are not already forcing Emscripten
      lt(this.compilation.compilerVersion, '0.8.21') &&
      !settings.optimizer?.enabled &&
      settings.viaIR
    ) {
      logInfo('Force Emscripten compiler', {
        address: this.address,
        chainId: this.sourcifyChain.chainId,
      });

      // Try to verify again with Emscripten
      return SolidityBugType.IR_OUTPUT_ORDERING_BUG;
    }

    return SolidityBugType.NONE;
  }

  private async matchBytecodes(
    isCreation: boolean,
    populatedRecompiledBytecode: string,
  ): Promise<BytecodeMatchingResult> {
    // Here we use bytecodes from the context because they are already processed
    const onchainBytecode = isCreation
      ? this.onchainCreationBytecode
      : this.onchainRuntimeBytecode;

    const cborAuxdata = isCreation
      ? this.compilation.creationBytecodeCborAuxdata
      : this.compilation.runtimeBytecodeCborAuxdata;

    const linkReferences = isCreation
      ? this.compilation.creationLinkReferences
      : this.compilation.runtimeLinkReferences;

    const result: BytecodeMatchingResult = {
      match: null,
      transformations: [],
      transformationValues: {},
      populatedRecompiledBytecode,
    };

    // Library transformations can be in both the runtime bytecode and creation bytecode, hence done here in `matchBytecodes` method.
    const librariesTransformationResult = extractLibrariesTransformation(
      populatedRecompiledBytecode,
      onchainBytecode,
      linkReferences,
    );
    const libraryMap = librariesTransformationResult.libraryMap;
    populatedRecompiledBytecode =
      librariesTransformationResult.populatedRecompiledBytecode;

    // Direct bytecode match
    const doBytecodesMatch = isCreation
      ? onchainBytecode.startsWith(populatedRecompiledBytecode)
      : populatedRecompiledBytecode === onchainBytecode;

    if (doBytecodesMatch) {
      // If there is perfect match but auxdata doesn't contain any metadata hash, return partial match
      if (
        !cborAuxdata ||
        Object.keys(cborAuxdata).length === 0 ||
        Object.values(cborAuxdata).some((cborAuxdata) => {
          try {
            const { ipfs, bzzr0, bzzr1 } = decodeBytecode(
              cborAuxdata.value,
              this.compilation.auxdataStyle,
            ) as SolidityDecodedObject;
            return (
              ipfs === undefined && bzzr0 === undefined && bzzr1 === undefined
            );
          } catch {
            return true;
          }
        })
      ) {
        result.match = 'partial';
      } else {
        result.match = 'perfect';
      }

      result.libraryMap = libraryMap;
      result.transformations = librariesTransformationResult.transformations;
      result.transformationValues =
        librariesTransformationResult.transformationValues;
      return result;
    }

    // If bytecodes don't match and no auxdata to ignore, return null
    if (!cborAuxdata || Object.keys(cborAuxdata).length === 0) {
      return result;
    }

    const auxdataTransformationResult = extractAuxdataTransformation(
      populatedRecompiledBytecode,
      onchainBytecode,
      cborAuxdata,
    );

    result.populatedRecompiledBytecode =
      auxdataTransformationResult.populatedRecompiledBytecode;

    /* eslint-disable indent */
    const doPopulatedBytecodesMatch = isCreation
      ? onchainBytecode.startsWith(
          auxdataTransformationResult.populatedRecompiledBytecode,
        )
      : auxdataTransformationResult.populatedRecompiledBytecode ===
        onchainBytecode;
    /* eslint-enable indent */

    if (doPopulatedBytecodesMatch) {
      result.match = 'partial';
      result.libraryMap = libraryMap;
      result.transformations = [
        ...result.transformations,
        ...librariesTransformationResult.transformations,
        ...auxdataTransformationResult.transformations,
      ];
      result.transformationValues = {
        ...result.transformationValues,
        ...librariesTransformationResult.transformationValues,
        ...auxdataTransformationResult.transformationValues,
      };
    }

    return result;
  }

  private async matchWithRuntimeBytecode() {
    // Check if is a library with call protection
    const callProtectionTransformationResult =
      extractCallProtectionTransformation(
        this.compilation.runtimeBytecode,
        this.onchainRuntimeBytecode,
      );

    // Handle immutable references
    const immutablesTransformationResult = extractImmutablesTransformation(
      callProtectionTransformationResult.populatedRecompiledBytecode,
      this.onchainRuntimeBytecode,
      this.compilation.immutableReferences,
      this.compilation.auxdataStyle,
    );

    const matchBytecodesResult = await this.matchBytecodes(
      false,
      immutablesTransformationResult.populatedRecompiledBytecode,
    );

    this.runtimeTransformations = [
      ...callProtectionTransformationResult.transformations,
      ...immutablesTransformationResult.transformations,
      ...matchBytecodesResult.transformations,
    ];
    this.runtimeTransformationValues = {
      ...callProtectionTransformationResult.transformationValues,
      ...immutablesTransformationResult.transformationValues,
      ...matchBytecodesResult.transformationValues,
    };

    this.runtimeMatch = matchBytecodesResult.match;
    this.runtimeLibraryMap = matchBytecodesResult.libraryMap;
  }

  private async matchWithCreationTx() {
    const matchBytecodesResult = await this.matchBytecodes(
      true,
      this.compilation.creationBytecode,
    );

    this.creationMatch = matchBytecodesResult.match;
    this.creationLibraryMap = matchBytecodesResult.libraryMap;
    this.creationTransformations = matchBytecodesResult.transformations;
    this.creationTransformationValues =
      matchBytecodesResult.transformationValues;

    if (
      matchBytecodesResult.match === 'partial' ||
      matchBytecodesResult.match === 'perfect'
    ) {
      const constructorTransformationResult =
        extractConstructorArgumentsTransformation(
          matchBytecodesResult.populatedRecompiledBytecode,
          this.onchainCreationBytecode,
          this.compilation.metadata,
        );
      this.creationTransformations = [
        ...this.creationTransformations,
        ...constructorTransformationResult.transformations,
      ];
      this.creationTransformationValues = {
        ...this.creationTransformationValues,
        ...constructorTransformationResult.transformationValues,
      };
    }
  }

  get status() {
    return {
      runtimeMatch: this.runtimeMatch,
      creationMatch: this.creationMatch,
    };
  }

  get onchainRuntimeBytecode() {
    if (!this._onchainRuntimeBytecode) {
      throw new VerificationError(
        'Onchain runtime bytecode not available',
        'onchain_runtime_bytecode_not_available',
      );
    }
    return this._onchainRuntimeBytecode;
  }

  get onchainCreationBytecode() {
    if (!this._onchainCreationBytecode) {
      throw new VerificationError(
        'Onchain creation bytecode not available',
        'onchain_creation_bytecode_not_available',
      );
    }
    return this._onchainCreationBytecode;
  }

  get transformations() {
    return {
      runtime: {
        list: this.runtimeTransformations,
        values: this.runtimeTransformationValues,
      },
      creation: {
        list: this.creationTransformations,
        values: this.creationTransformationValues,
      },
    };
  }

  get deploymentInfo() {
    return {
      blockNumber: this.blockNumber,
      txIndex: this.txIndex,
      deployer: this.deployer,
      txHash: this.creatorTxHash,
    };
  }

  get libraryMap() {
    return {
      runtime: this.runtimeLibraryMap,
      creation: this.creationLibraryMap,
    };
  }

  get chainId() {
    return this.sourcifyChain.chainId;
  }
}
