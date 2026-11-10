import {
  AuxdataStyle,
  decode,
  splitAuxdata,
} from '@ethereum-sourcify/bytecode-utils';
import { parseSlangVersion } from '@ethereum-sourcify/compilers-types';
import type {
  SlangJsonInput,
  SlangOutput,
  SolidityOutputContract,
} from '@ethereum-sourcify/compilers-types';
import { findContractInCompilerOutput } from './AbstractCompilation';
import { SolidityCompilation } from './SolidityCompilation';
import type {
  CompiledContractCborAuxdata,
  ISlangCompiler,
} from './CompilationTypes';
import { CompilationError } from './CompilationTypes';
import { logWarn } from '../logger';

// Slang rejects selectors it does not know, e.g. evm.legacyAssembly
export const SLANG_OUTPUT_SELECTION_FIELDS = [
  'abi',
  'devdoc',
  'userdoc',
  'storageLayout',
  'transientStorageLayout',
  'evm.bytecode.object',
  'evm.bytecode.sourceMap',
  'evm.bytecode.linkReferences',
  'evm.deployedBytecode.object',
  'evm.deployedBytecode.sourceMap',
  'evm.deployedBytecode.linkReferences',
  'evm.deployedBytecode.immutableReferences',
  'metadata',
] as const;

type CborAuxdata = CompiledContractCborAuxdata[string];

// The CBOR key "slang" and the header of its 3-byte value
const SLANG_CBOR_KEY = '65736c616e6743';
// The start of a trailer with a metadata hash: a map of 2 with the key "ipfs"
const IPFS_TRAILER_START = 'a26469706673';
// A trailer is 54 bytes today, the margin allows more fields
const MAX_TRAILER_BYTES = 128;

function decodeSlangTrailer(trailer: string) {
  try {
    const decoded = decode(`0x${trailer}`, AuxdataStyle.SOLIDITY);
    return decoded.slangVersion !== undefined ? decoded : undefined;
  } catch {
    return undefined;
  }
}

// Returns the trailer at the end of a bytecode with 0x prefix
function findTrailerAtEnd(bytecode: string): CborAuxdata | undefined {
  const [, auxdata, lengthHex] = splitAuxdata(bytecode, AuxdataStyle.SOLIDITY);
  if (!auxdata || lengthHex === undefined) {
    return undefined;
  }
  const trailer = `${auxdata}${lengthHex}`;
  return {
    offset: (bytecode.length - 2 - trailer.length) / 2,
    value: `0x${trailer}`,
  };
}

// Returns the trailer that starts at the given character, if there is one
function findTrailerAt(bytecode: string, start: number): string | undefined {
  // The last 2 bytes of a trailer are the length of the bytes before them
  for (let bytes = 3; bytes <= MAX_TRAILER_BYTES; bytes++) {
    const lengthStart = start + (bytes - 2) * 2;
    const lengthHex = bytecode.slice(lengthStart, lengthStart + 4);
    if (lengthHex.length < 4) {
      return undefined;
    }
    if (parseInt(lengthHex, 16) !== bytes - 2) {
      continue;
    }
    const trailer = bytecode.slice(start, lengthStart + 4);
    if (decodeSlangTrailer(trailer)?.ipfs !== undefined) {
      return trailer;
    }
  }
  return undefined;
}

// Finds the trailers from a compilation of edited sources: only the metadata hashes differ.
// A search for the trailer bytes is not safe, the contract code can contain them.
export function findSlangAuxdataPositions(
  originalBytecode: string,
  editedBytecode: string,
): CompiledContractCborAuxdata {
  if (originalBytecode.length !== editedBytecode.length) {
    throw new Error('The edited bytecode has a different length');
  }
  const result: CompiledContractCborAuxdata = {};
  let trailerEnd = 0;
  for (let pos = 2; pos < originalBytecode.length; pos++) {
    if (pos < trailerEnd || originalBytecode[pos] === editedBytecode[pos]) {
      continue;
    }
    // The trailer starts on a byte boundary before the difference
    const firstStart = pos - (pos % 2);
    const lastStart = Math.max(2, firstStart - MAX_TRAILER_BYTES * 2);
    let trailer: string | undefined;
    let start = firstStart;
    for (; start >= lastStart; start -= 2) {
      if (!originalBytecode.startsWith(IPFS_TRAILER_START, start)) {
        continue;
      }
      trailer = findTrailerAt(originalBytecode, start);
      if (trailer !== undefined && start + trailer.length > pos) {
        break;
      }
      trailer = undefined;
    }
    if (trailer === undefined) {
      throw new Error(`No trailer found at the difference ${pos}`);
    }
    trailerEnd = start + trailer.length;
    result[`${Object.keys(result).length + 1}`] = {
      offset: (start - 2) / 2,
      value: `0x${trailer}`,
    };
  }
  return result;
}

// True when the bytecode can hold more trailers than the one at its end
function mayHaveMoreTrailers(bytecode: string, last: CborAuxdata): boolean {
  const code = bytecode.slice(0, bytecode.length - (last.value.length - 2));
  for (
    let index = code.indexOf(SLANG_CBOR_KEY);
    index !== -1;
    index = code.indexOf(SLANG_CBOR_KEY, index + 1)
  ) {
    if (index % 2 === 0) {
      return true;
    }
  }
  return false;
}

// A Solidity compilation with Slang, the version is <slang version>+slang
export class SlangCompilation extends SolidityCompilation {
  declare compiler: ISlangCompiler;
  declare jsonInput: SlangJsonInput;
  declare compilerOutput?: SlangOutput;

  assertSupportedVersion() {
    if (!parseSlangVersion(this.compilerVersion)) {
      throw new CompilationError({ code: 'invalid_compiler_version' });
    }
  }

  initSolidityJsonInput() {
    this.jsonInput.settings.outputSelection = {
      [this.compilationTarget.path]: {
        [this.compilationTarget.name]: [...SLANG_OUTPUT_SELECTION_FIELDS],
      },
    };
  }

  // Without CBOR, bytes that look like a trailer are contract data
  private get appendsCbor(): boolean {
    return this.jsonInput.settings.metadata?.appendCBOR !== false;
  }

  // Slang has no emscripten build, so forceEmscripten is ignored
  public async compile() {
    await super.compile(false);
    if (this.metadata?.compiler?.name !== 'slang') {
      throw new CompilationError({ code: 'invalid_compiler_version' });
    }
    // Builds before NomicFoundation/solx#897 name Slang under the solc key
    const trailer = this.appendsCbor
      ? findTrailerAtEnd(this.runtimeBytecode)
      : undefined;
    if (trailer && !decodeSlangTrailer(trailer.value.slice(2))) {
      throw new CompilationError({ code: 'unsupported_compiler_version' });
    }
  }

  public async generateCborAuxdataPositions() {
    try {
      this._runtimeBytecodeCborAuxdata = {};
      this._creationBytecodeCborAuxdata = {};
      const runtime = this.runtimeBytecode;
      const creation = this.creationBytecode;
      const lastTrailer = this.appendsCbor
        ? findTrailerAtEnd(runtime)
        : undefined;
      if (!lastTrailer) {
        return;
      }
      this._runtimeBytecodeCborAuxdata = { '1': lastTrailer };
      // The creation code normally ends with the runtime code and its trailer
      const endsWithRuntime = creation.endsWith(runtime.slice(2));
      if (endsWithRuntime) {
        this._creationBytecodeCborAuxdata = {
          '1': {
            offset: lastTrailer.offset + (creation.length - runtime.length) / 2,
            value: lastTrailer.value,
          },
        };
        // A factory also has the trailers of the contracts it creates
        if (!mayHaveMoreTrailers(creation, lastTrailer)) {
          return;
        }
      }

      const editedOutput = await this.generateEditedContract({
        version: this.compilerVersion,
        solcJsonInput: this.jsonInput,
        forceEmscripten: false,
      });
      const editedContract = findContractInCompilerOutput(
        editedOutput,
        this.compilationTarget,
      ) as SolidityOutputContract;
      const runtimeTrailers = findSlangAuxdataPositions(
        runtime,
        `0x${editedContract.evm.deployedBytecode.object}`,
      );
      const creationTrailers = findSlangAuxdataPositions(
        creation,
        `0x${editedContract.evm.bytecode.object}`,
      );
      // Without a metadata hash the bytecodes are equal, keep the last trailer
      if (Object.keys(runtimeTrailers).length > 0) {
        this._runtimeBytecodeCborAuxdata = runtimeTrailers;
      }
      if (Object.keys(creationTrailers).length > 0) {
        this._creationBytecodeCborAuxdata = creationTrailers;
      }
    } catch (error) {
      logWarn('Cannot generate cbor auxdata positions', {
        error,
      });
      throw new CompilationError({
        code: 'cannot_generate_cbor_auxdata_positions',
      });
    }
  }
}
