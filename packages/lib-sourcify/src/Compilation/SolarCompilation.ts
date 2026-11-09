import { parseSolarVersion } from '@ethereum-sourcify/compilers-types';
import type {
  SolarCborAuxdata,
  SolarJsonInput,
  SolarOutput,
  SolarOutputContract,
} from '@ethereum-sourcify/compilers-types';
import { SolidityCompilation } from './SolidityCompilation';
import type {
  CompilationTarget,
  CompiledContractCborAuxdata,
  ISolarCompiler,
} from './CompilationTypes';
import { CompilationError } from './CompilationTypes';

// Solar emits no legacyAssembly, but reports the auxdata positions itself
export const SOLAR_OUTPUT_SELECTION_FIELDS = [
  'abi',
  'devdoc',
  'userdoc',
  'storageLayout',
  'transientStorageLayout',
  'evm.bytecode.object',
  'evm.bytecode.sourceMap',
  'evm.bytecode.linkReferences',
  'evm.bytecode.cborAuxdata',
  'evm.deployedBytecode.object',
  'evm.deployedBytecode.sourceMap',
  'evm.deployedBytecode.linkReferences',
  'evm.deployedBytecode.immutableReferences',
  'evm.deployedBytecode.cborAuxdata',
  'metadata',
] as const;

/**
 * Converts Solar's per-contract auxdata trailers into the numbered map that
 * Sourcify stores. Contracts with identical code share one trailer, which
 * Solar lists under each owner at the same offset, so offsets are deduplicated.
 */
export function flattenSolarCborAuxdata(
  cborAuxdata: SolarCborAuxdata | undefined,
): CompiledContractCborAuxdata {
  if (!cborAuxdata) {
    throw new CompilationError({
      code: 'cannot_generate_cbor_auxdata_positions',
    });
  }
  const byOffset = new Map<number, string>();
  for (const trailers of Object.values(cborAuxdata)) {
    for (const { offset, value } of trailers) {
      byOffset.set(offset, value);
    }
  }
  const result: CompiledContractCborAuxdata = {};
  [...byOffset.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([offset, value], index) => {
      result[`${index + 1}`] = { offset, value };
    });
  return result;
}

/**
 * A Solidity compilation with the Solar compiler.
 * The version has the form <solc>+commit.<sha8>.solar.<solar version>.
 */
export class SolarCompilation extends SolidityCompilation {
  declare compiler: ISolarCompiler;
  declare jsonInput: SolarJsonInput;
  declare compilerOutput?: SolarOutput;

  public constructor(
    compiler: ISolarCompiler,
    compilerVersion: string,
    jsonInput: SolarJsonInput,
    compilationTarget: CompilationTarget,
  ) {
    super(compiler, compilerVersion, jsonInput, compilationTarget);
    if (!parseSolarVersion(this.compilerVersion)) {
      throw new CompilationError({ code: 'invalid_compiler_version' });
    }
  }

  initSolidityJsonInput() {
    this.jsonInput.settings.outputSelection = {
      [this.compilationTarget.path]: {
        [this.compilationTarget.name]: [...SOLAR_OUTPUT_SELECTION_FIELDS],
      },
    };
  }

  // Solar has no emscripten build, so forceEmscripten is ignored
  public async compile() {
    await super.compile(false);
    // SOLC_WRAPPER_VERSION changes only the solc part of the version a user sends.
    // Store the version from the metadata so one build always has one version.
    // The compiler (assertSolarBuild) guarantees that the binary is the
    // requested commit and Solar version, so the metadata names the same build.
    const metadataVersion = this.metadata?.compiler?.version;
    if (!metadataVersion || !parseSolarVersion(metadataVersion)) {
      throw new CompilationError({ code: 'invalid_compiler_version' });
    }
    this.compilerVersion = metadataVersion;
  }

  public async generateCborAuxdataPositions() {
    const contract = this.contractCompilerOutput as SolarOutputContract;
    this._creationBytecodeCborAuxdata = flattenSolarCborAuxdata(
      contract.evm.bytecode.cborAuxdata,
    );
    this._runtimeBytecodeCborAuxdata = flattenSolarCborAuxdata(
      contract.evm.deployedBytecode.cborAuxdata,
    );
  }
}
