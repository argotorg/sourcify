import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import type {
  ImmutableReferences,
  LinkReferences,
  Metadata,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
} from '@ethereum-sourcify/compilers-types';
import { AbstractCompilation } from './AbstractCompilation';
import type {
  CompilationLanguage,
  CompilationTarget,
  IZkSolcCompiler,
} from './CompilationTypes';
import { CompilationError } from './CompilationTypes';
import { logDebug, logInfo, logSilly, logWarn } from '../logger';

const ZKSOLC_CONTRACT_OUTPUTS = ['abi', 'metadata', 'evm'] as const;

type OutputSelection = NonNullable<
  SolidityJsonInput['settings']['outputSelection']
>;

function ensureSelectorOutputs(
  outputSelection: OutputSelection,
  sourcePath: string,
  contractName: string,
  outputs: readonly string[],
) {
  if (
    !outputSelection[sourcePath] ||
    typeof outputSelection[sourcePath] !== 'object' ||
    Array.isArray(outputSelection[sourcePath])
  ) {
    outputSelection[sourcePath] = {};
  }

  if (!Array.isArray(outputSelection[sourcePath][contractName])) {
    outputSelection[sourcePath][contractName] = [];
  }

  for (const output of outputs) {
    if (!outputSelection[sourcePath][contractName].includes(output)) {
      outputSelection[sourcePath][contractName].push(output);
    }
  }
}

function mergeOutputSelection(
  jsonInput: SolidityJsonInput,
  compilationTarget: CompilationTarget,
): OutputSelection {
  const existingOutputSelection = jsonInput.settings.outputSelection || {};
  const outputSelection = structuredClone(existingOutputSelection);

  ensureSelectorOutputs(outputSelection, '*', '*', ZKSOLC_CONTRACT_OUTPUTS);
  ensureSelectorOutputs(outputSelection, '*', '', ['abi']);
  ensureSelectorOutputs(
    outputSelection,
    compilationTarget.path,
    compilationTarget.name,
    ZKSOLC_CONTRACT_OUTPUTS,
  );

  return outputSelection;
}

/**
 * Abstraction of a zksolc Solidity compilation that targets zkSync EraVM.
 */
export class ZkSolcCompilation extends AbstractCompilation {
  public language: CompilationLanguage = 'Solidity';
  public readonly targetVM = 'eravm';

  // Use declare to override AbstractCompilation's types to target Solidity types
  declare jsonInput: SolidityJsonInput;
  declare compilerOutput?: SolidityOutput;

  // EraVM auxdata handling is different from Solidity/EVM CBOR extraction and is
  // intentionally left empty until the verification matcher handles EraVM.
  readonly auxdataStyle: AuxdataStyle.SOLIDITY = AuxdataStyle.SOLIDITY;

  public readonly zksolcVersion: string;

  public constructor(
    public compiler: IZkSolcCompiler,
    zksolcVersion: string,
    public solcCompilerVersion: string,
    jsonInput: SolidityJsonInput,
    public compilationTarget: CompilationTarget,
  ) {
    super(zksolcVersion, jsonInput);
    this.zksolcVersion = zksolcVersion;
    this.initZkSolcJsonInput();
  }

  initZkSolcJsonInput() {
    this.jsonInput.settings.outputSelection = mergeOutputSelection(
      this.jsonInput,
      this.compilationTarget,
    );
  }

  public async compileAndReturnCompilationTarget(): Promise<SolidityOutputContract> {
    const compilationStartTime = Date.now();
    logDebug('Compiling zkSync EraVM contract', {
      zksolcVersion: this.zksolcVersion,
      solcVersion: this.solcCompilerVersion,
      contract: this.compilationTarget.name,
      path: this.compilationTarget.path,
    });
    logSilly('Compilation input', { solcJsonInput: this.jsonInput });

    try {
      this.compilerOutput = await this.compiler.compile(
        this.zksolcVersion,
        this.solcCompilerVersion,
        this.jsonInput,
      );
    } catch (e: any) {
      logWarn('Compiler error', {
        error: e.errors ? e.errors : e.message,
      });
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

    const compilationTargetContract = this
      .contractCompilerOutput as SolidityOutputContract;

    const compilationEndTime = Date.now();
    this.compilationTime = compilationEndTime - compilationStartTime;
    logSilly('Compilation output', { compilerOutput: this.compilerOutput });
    logInfo('Compiled zkSync EraVM contract', {
      zksolcVersion: this.zksolcVersion,
      solcVersion: this.solcCompilerVersion,
      contract: this.compilationTarget.name,
      path: this.compilationTarget.path,
      compilationDuration: `${this.compilationTime}ms`,
    });

    return compilationTargetContract;
  }

  public async compile() {
    const contract = await this.compileAndReturnCompilationTarget();
    if (contract.metadata) {
      this._metadata = JSON.parse(contract.metadata.trim()) as Metadata;
    } else {
      this._metadata = undefined;
    }
  }

  public async generateCborAuxdataPositions() {
    this._creationBytecodeCborAuxdata = {};
    this._runtimeBytecodeCborAuxdata = {};
  }

  get creationBytecode() {
    return `0x${this.contractCompilerOutput.evm.bytecode.object}`;
  }

  get runtimeBytecode() {
    return `0x${this.contractCompilerOutput.evm.bytecode.object}`;
  }

  get immutableReferences(): ImmutableReferences {
    const compilationTarget = this.contractCompilerOutput as any;
    return (
      compilationTarget.evm.deployedBytecode?.immutableReferences ||
      compilationTarget.evm.bytecode.immutableReferences ||
      {}
    );
  }

  get runtimeLinkReferences(): LinkReferences {
    const compilationTarget = this
      .contractCompilerOutput as SolidityOutputContract;
    return compilationTarget.evm.bytecode.linkReferences || {};
  }

  get creationLinkReferences(): LinkReferences {
    const compilationTarget = this
      .contractCompilerOutput as SolidityOutputContract;
    return compilationTarget.evm.bytecode.linkReferences || {};
  }
}
