import { AuxdataStyle, splitAuxdata } from '@ethereum-sourcify/bytecode-utils';
import type {
  ImmutableReferences,
  LinkReferences,
  Metadata,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
} from '@ethereum-sourcify/compilers-types';
import semver from 'semver';
import { AbstractCompilation } from './AbstractCompilation';
import type {
  CompilationLanguage,
  CompilationTarget,
  CompiledContractCborAuxdata,
  IZkSolcCompiler,
} from './CompilationTypes';
import { CompilationError } from './CompilationTypes';
import { logDebug, logInfo, logSilly, logWarn } from '../logger';

const ZKSOLC_BASE_CONTRACT_OUTPUTS = ['abi', 'storageLayout'] as const;
const ZKSOLC_METADATA_CONTRACT_OUTPUTS = [
  'metadata',
  'userdoc',
  'devdoc',
] as const;
const ZKSOLC_EVM_CONTRACT_OUTPUTS = ['evm'] as const;
const SOLC_RELEASE_VERSION_REGEX =
  /^v?(\d+\.\d+\.\d+)(\+commit\.[a-fA-F0-9]+)?$/;
const ERA_SOLC_VERSION_REGEX = /^v?(?:zkVM-)?(\d+\.\d+\.\d+)-(1\.0\.[0-2])$/;
const ERA_SOLC_EDITIONS = ['1.0.2', '1.0.1', '1.0.0'] as const;
const MIN_SUPPORTED_ERA_SOLC_SOLIDITY_VERSION = '0.4.12';
const MAX_SUPPORTED_ERA_SOLC_SOLIDITY_VERSION = '0.8.30';
const MAX_ERA_SOLC_1_0_0_SOLIDITY_VERSION = '0.8.25';
const MIN_ZKSOLC_VERSION_WITH_METADATA_OUTPUTS = '1.3.6';
const ERA_VM_METADATA_HASH_LENGTH_BYTES = 32;
const ERA_VM_WORD_SIZE_BYTES = 32;
const ERA_VM_ZERO_WORD_HEX = '00'.repeat(ERA_VM_WORD_SIZE_BYTES);

type EraSolcEdition = (typeof ERA_SOLC_EDITIONS)[number];

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
  zksolcVersion: string,
): OutputSelection {
  const existingOutputSelection = jsonInput.settings.outputSelection || {};
  const outputSelection = structuredClone(existingOutputSelection);
  const contractOutputs = getZkSolcContractOutputs(zksolcVersion);

  ensureSelectorOutputs(outputSelection, '*', '*', contractOutputs);
  ensureSelectorOutputs(outputSelection, '*', '', ['abi']);
  ensureSelectorOutputs(
    outputSelection,
    compilationTarget.path,
    compilationTarget.name,
    contractOutputs,
  );

  return outputSelection;
}

function parseContractMetadata(metadata: unknown): Metadata | undefined {
  if (!metadata) {
    return undefined;
  }

  if (typeof metadata === 'string') {
    return JSON.parse(metadata.trim()) as Metadata;
  }

  return metadata as Metadata;
}

function stripLeadingV(version: string): string {
  return version.trim().replace(/^v/, '');
}

function isZkSolcVersionAtLeastV15(version: string): boolean {
  // Pre-release of 1.5.0 (git-SHA suffix). semver.parse rejects it; without
  // this guard the unparseable-default below would treat it as ≥ 1.5, when in
  // fact it predates the 1.5.0 release and must use the pre-1.5 CLI shape.
  if (version === 'vm-1.5.0-a167aa3') {
    return false;
  }

  const parsedVersion = semver.parse(stripLeadingV(version));
  if (!parsedVersion) {
    return true;
  }

  return semver.gte(parsedVersion, '1.5.0');
}

function supportsZkSolcMetadataOutputs(version: string): boolean {
  const parsedVersion = semver.parse(stripLeadingV(version));
  if (!parsedVersion) {
    return true;
  }

  return semver.gte(parsedVersion, MIN_ZKSOLC_VERSION_WITH_METADATA_OUTPUTS);
}

function getZkSolcContractOutputs(zksolcVersion: string): readonly string[] {
  const outputs: string[] = [...ZKSOLC_BASE_CONTRACT_OUTPUTS];

  if (supportsZkSolcMetadataOutputs(zksolcVersion)) {
    outputs.push(...ZKSOLC_METADATA_CONTRACT_OUTPUTS);
  }

  if (isZkSolcVersionAtLeastV15(zksolcVersion)) {
    outputs.push(...ZKSOLC_EVM_CONTRACT_OUTPUTS);
  }

  return outputs;
}

function isSupportedSolidityVersion(solcVersion: string): boolean {
  return (
    Boolean(semver.valid(solcVersion)) &&
    semver.gte(solcVersion, MIN_SUPPORTED_ERA_SOLC_SOLIDITY_VERSION) &&
    semver.lte(solcVersion, MAX_SUPPORTED_ERA_SOLC_SOLIDITY_VERSION)
  );
}

function isEraSolcEditionAvailable(
  solcVersion: string,
  edition: EraSolcEdition,
): boolean {
  if (!isSupportedSolidityVersion(solcVersion)) {
    return false;
  }

  if (edition === '1.0.0') {
    return semver.lte(solcVersion, MAX_ERA_SOLC_1_0_0_SOLIDITY_VERSION);
  }

  return true;
}

function isEraSolcEditionCompatibleWithZkSolc(
  zksolcVersion: string,
  edition: EraSolcEdition,
): boolean {
  return edition !== '1.0.2' || isZkSolcVersionAtLeastV15(zksolcVersion);
}

function isSupportedEraSolcVersion(
  solcVersion: string,
  edition: EraSolcEdition,
  zksolcVersion: string,
): boolean {
  return (
    isEraSolcEditionAvailable(solcVersion, edition) &&
    isEraSolcEditionCompatibleWithZkSolc(zksolcVersion, edition)
  );
}

export function getZkSolcCompilerVersionCandidates(
  compilerVersion: string,
  zksolcVersion: string,
): string[] {
  const normalizedCompilerVersion = compilerVersion.trim();
  const eraSolcMatch = normalizedCompilerVersion.match(ERA_SOLC_VERSION_REGEX);
  if (eraSolcMatch?.[1] && eraSolcMatch?.[2]) {
    const solcVersion = eraSolcMatch[1];
    const edition = eraSolcMatch[2] as EraSolcEdition;
    return isSupportedEraSolcVersion(solcVersion, edition, zksolcVersion)
      ? [`${solcVersion}-${edition}`]
      : [];
  }

  const solcReleaseMatch = normalizedCompilerVersion.match(
    SOLC_RELEASE_VERSION_REGEX,
  );
  if (!solcReleaseMatch?.[1]) {
    return [compilerVersion];
  }

  const solcVersion = solcReleaseMatch[1];
  const eraSolcCandidates = ERA_SOLC_EDITIONS.filter((edition) =>
    isSupportedEraSolcVersion(solcVersion, edition, zksolcVersion),
  ).map((edition) => `${solcVersion}-${edition}`);
  if (solcReleaseMatch[2]) {
    return [normalizedCompilerVersion, ...eraSolcCandidates];
  }

  return eraSolcCandidates;
}

// A zksolc compilation is identified by a single combined compiler-version string
// of the form `zksolc:<zksolcVersion>;solc:<solcVersion>`, where the `solc` half is
// either an era-solc release (`0.8.26-1.0.2`) or an upstream solc (`0.8.26` /
// `v0.8.26+commit.<hash>`). This one string is the canonical representation used
// across the verification API, lib-sourcify, and the database `version` column, so
// the `zksolc:` prefix is also what distinguishes a zksolc compilation from a plain
// Solidity one.
const ZKSOLC_COMPILER_VERSION_STRING_REGEX = /^zksolc:([^;]+);solc:(.+)$/;

export function isZkSolcCompilerVersion(compilerVersion: string): boolean {
  return compilerVersion.trim().startsWith('zksolc:');
}

export function parseZkSolcCompilerVersion(compilerVersion: string): {
  zksolcVersion: string;
  solcCompilerVersion: string;
} {
  // Expected form: "zksolc:<zksolcVersion>;solc:<solcVersion>",
  // e.g. "zksolc:1.5.16;solc:0.8.26-1.0.2".
  const match = compilerVersion
    .trim()
    .match(ZKSOLC_COMPILER_VERSION_STRING_REGEX);
  if (!match) {
    throw new CompilationError({ code: 'invalid_compiler_version' });
  }
  return {
    zksolcVersion: match[1].trim(),
    solcCompilerVersion: match[2].trim(),
  };
}

export function formatZkSolcCompilerVersion(
  zksolcVersion: string,
  solcCompilerVersion: string,
): string {
  return `zksolc:${zksolcVersion};solc:${solcCompilerVersion}`;
}

/**
 * Abstraction of a zksolc Solidity compilation that targets zkSync EraVM.
 */
export class ZkSolcCompilation extends AbstractCompilation {
  public language: CompilationLanguage = 'Solidity';

  // Use declare to override AbstractCompilation's types to target Solidity types
  declare jsonInput: SolidityJsonInput;
  declare compilerOutput?: SolidityOutput;

  readonly auxdataStyle: AuxdataStyle.ZKSYNC = AuxdataStyle.ZKSYNC;

  public readonly zksolcVersion: string;
  public readonly solcCompilerVersion: string;

  /**
   * @param compilerVersion the combined `zksolc:<zksolcVersion>;solc:<solcVersion>`
   *   string (see {@link parseZkSolcCompilerVersion}). Both versions are used
   *   exactly as given; the `solc` half must be a concrete era-solc release or
   *   upstream solc version.
   */
  public constructor(
    public compiler: IZkSolcCompiler,
    compilerVersion: string,
    jsonInput: SolidityJsonInput,
    public compilationTarget: CompilationTarget,
  ) {
    const { zksolcVersion, solcCompilerVersion } =
      parseZkSolcCompilerVersion(compilerVersion);
    super(zksolcVersion, jsonInput);
    this.zksolcVersion = zksolcVersion;
    this.solcCompilerVersion = solcCompilerVersion;
    this.initZkSolcJsonInput();
  }

  // The combined `zksolc:<v>;solc:<v>` string for the currently-resolved
  // toolchain. This (not the inherited `compilerVersion`, which stays the plain
  // zksolc semver so the Solidity heuristics in Verification can still parse it)
  // is what gets exported and stored as the contract's compiler version.
  public get resolvedCompilerVersion(): string {
    return formatZkSolcCompilerVersion(
      this.zksolcVersion,
      this.solcCompilerVersion,
    );
  }

  initZkSolcJsonInput() {
    this.jsonInput.settings.outputSelection = mergeOutputSelection(
      this.jsonInput,
      this.compilationTarget,
      this.zksolcVersion,
    );
  }

  public get compilerName(): string {
    return 'zksolc';
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
    this._metadata = parseContractMetadata(contract.metadata);
  }

  public async generateCborAuxdataPositions() {
    this._creationBytecodeCborAuxdata = {};
    this._runtimeBytecodeCborAuxdata = this.generateEraVmAuxdataPosition(
      this.runtimeBytecode,
    );
  }

  private generateEraVmAuxdataPosition(
    bytecode: string,
  ): CompiledContractCborAuxdata {
    const bytecodeWithoutPrefix = bytecode.slice(2);
    const [, cborAuxdata, cborLengthHex] = splitAuxdata(
      bytecode,
      AuxdataStyle.ZKSYNC,
    );

    if (cborAuxdata && cborLengthHex !== undefined) {
      const auxdata = `${cborAuxdata}${cborLengthHex}`;
      return {
        '1': {
          offset: bytecodeWithoutPrefix.length / 2 - auxdata.length / 2,
          value: `0x${auxdata}`,
        },
      };
    }

    return this.generateEraVmMetadataHashPosition(bytecodeWithoutPrefix);
  }

  private generateEraVmMetadataHashPosition(
    bytecodeWithoutPrefix: string,
  ): CompiledContractCborAuxdata {
    if (this.isEraVmMetadataDisabled()) {
      return {};
    }

    const metadataHashLength = ERA_VM_METADATA_HASH_LENGTH_BYTES * 2;

    if (bytecodeWithoutPrefix.length < metadataHashLength) {
      return {};
    }

    let metadataStart = bytecodeWithoutPrefix.length - metadataHashLength;
    const paddingWordStart = metadataStart - ERA_VM_WORD_SIZE_BYTES * 2;
    if (
      paddingWordStart >= 0 &&
      bytecodeWithoutPrefix.substring(paddingWordStart, metadataStart) ===
        ERA_VM_ZERO_WORD_HEX
    ) {
      metadataStart = paddingWordStart;
    }

    return {
      '1': {
        offset: metadataStart / 2,
        value: `0x${bytecodeWithoutPrefix.slice(metadataStart)}`,
      },
    };
  }

  private isEraVmMetadataDisabled(): boolean {
    const metadata = (
      this.jsonInput.settings as {
        metadata?: {
          bytecodeHash?: string;
          hashType?: string;
          appendCBOR?: boolean;
        };
      }
    ).metadata;

    return (
      metadata?.bytecodeHash === 'none' ||
      metadata?.hashType === 'none' ||
      metadata?.appendCBOR === false
    );
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
