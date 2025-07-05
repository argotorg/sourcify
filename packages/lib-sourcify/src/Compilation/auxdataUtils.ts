import {
  CompilerAuxdataDiff,
  CompiledContractCborAuxdata,
} from './CompilationTypes';

function getAuxdataInLegacyAssemblyBranch(
  legacyAssemblyBranch: any,
  auxdatas: string[],
) {
  if (typeof legacyAssemblyBranch === 'object') {
    Object.keys(legacyAssemblyBranch).forEach((key) => {
      switch (key) {
        case '.auxdata': {
          auxdatas.push(legacyAssemblyBranch[key]);
          break;
        }
        case '.code': {
          break;
        }
        default: {
          if (key === '.data' || Number.isInteger(Number(key))) {
            return getAuxdataInLegacyAssemblyBranch(
              legacyAssemblyBranch[key],
              auxdatas,
            );
          }
        }
      }
    });
  }
}

export function findAuxdatasInLegacyAssembly(legacyAssembly: any) {
  const auxdatas: string[] = [];
  getAuxdataInLegacyAssemblyBranch(legacyAssembly, auxdatas);
  return auxdatas;
}

/**
 * Given two bytecodes, this function returns an array of ALL differing indexes.
 * @example getDiffPositions(['A', 'b', 'c', 'A', 'd'], ['A', 'x', 'y', 'A', 'z']) => [1, 2, 4]
 *
 */
function getDiffPositions(original: string, modified: string): number[] {
  const differences: number[] = [];
  const minLength = Math.min(original.length, modified.length);

  for (let i = 0; i < minLength; i++) {
    if (original[i] !== modified[i]) {
      differences.push(i);
    }
  }

  return differences;
}

/**
 *   Checks the raw bytecode indeed includes the auxdata diff at the given position
 */
function bytecodeIncludesCompilerAuxdataDiffAt(
  originalBytecode: string,
  compilerAuxdataDiff: CompilerAuxdataDiff,
  position: number,
): boolean {
  const { real, diffStart } = compilerAuxdataDiff;
  // the difference (i.e metadata hash) starts from "position". To get the whole auxdata instead of metadata go back "diffStart" and until + "real.length" of the auxdata.
  const extracted = originalBytecode.slice(
    position - diffStart,
    position - diffStart + real.length,
  );
  return extracted === real;
}

function getCompilerAuxdatasDiffs(
  auxdatasFromCompiler: string[],
  editedAuxdatasFromCompiler: string[],
) {
  const compilerAuxdataDiffs: CompilerAuxdataDiff[] = [];
  for (let i = 0; i < auxdatasFromCompiler.length; i++) {
    const diffPositions = getDiffPositions(
      auxdatasFromCompiler[i],
      editedAuxdatasFromCompiler[i],
    );
    compilerAuxdataDiffs.push({
      real: auxdatasFromCompiler[i],
      diffStart: diffPositions[0],
    });
  }
  return compilerAuxdataDiffs;
}

/**
 * The compiler outputs the auxdata values in the `legacyAssembly` field. However we can't use these values to do a simple
 * string search on the compiled bytecode because an attacker can embed these values in the compiled contract code and cause
 * the correspoding field in the onchain bytecode to be ignored falsely during verification.
 * A way to find the *metadata hashes* in the bytecode is to recompile the contract with a slightly edited source code and
 * compare the differences in the raw bytecodes. However, this will only give us the positions of the metadata hashes in the
 * bytecode. We need to find the positions of the whole *auxdata* in the bytecode.
 * So we go through each of the differences in the raw bytecode and check if an auxdata diff value from the legacyAssembly
 * is included in that difference. If it is, we have found the position of the auxdata in the bytecode.
 *
 * @param originalBytecode – bytecode produced from the **original** sources
 * @param editedBytecode   – bytecode produced from the *slightly different* sources
 * @param auxdatasFromCompiler – auxdata strings coming from the original compile
 * @param editedAuxdatasFromCompiler   – auxdata strings coming from the edited compile
 *
 * @returns an object whose keys are the indexes of the auxdata items
 *          (as they appear in `legacyAssembly`) and whose values are
 *          their position and value in the originalBytecode.
 */
export function findAuxdataPositions(
  originalBytecode: string,
  editedBytecode: string,
  auxdatasFromCompiler: string[],
  editedAuxdatasFromCompiler: string[],
): CompiledContractCborAuxdata {
  // 1. Build compilerAuxdataDiffs that explain how each auxdata is changing after recompilation with slightly different sources

  // A single CompilerAuxdataDiff has 2 keys: real, diffStart
  // In this example: { real: "a264....0033", diffStart: 10 }
  // original: a2646970667358221220123af2412fd4b1b89740f76c6ab76a6412bbde98fab732fb97eb012abe7123ff64736f6c63430007000033
  //           └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
  //               REAL
  // edited:   a2646970667358221220dceca8706b29e917dacf25fceef95acac8d90d765ac926663ce4096195952b6164736f6c63430007000033
  //           └──────────────────┘
  //             DIFFSTART(length)
  const compilerAuxdataDiffs = getCompilerAuxdatasDiffs(
    auxdatasFromCompiler,
    editedAuxdatasFromCompiler,
  );

  // 2. All bytecode character positions that differ after recompilation with slightly different sources
  const bytecodeDiffPositions = getDiffPositions(
    originalBytecode,
    editedBytecode,
  );

  // 3.  For every bytecodeDiffPosition, see if it hosts an compilerAuxdataDiff
  const resultAuxdatas: CompiledContractCborAuxdata = {};
  let prevPos = -Infinity;
  for (const pos of bytecodeDiffPositions) {
    // Skip positions that are immediately consecutive to the previous one,
    // two compilerAuxdataDiffs can't be adjacent to each other
    if (pos === prevPos + 1) {
      prevPos = pos;
      continue;
    }

    // For each bytecodeDiffPosition, test every compilerAuxdataDiff that we haven't already mapped
    for (let i = 0; i < compilerAuxdataDiffs.length; i++) {
      // Get the current compilerAuxdataDiff
      const compilerAuxdataDiff = compilerAuxdataDiffs[i];
      // The CompiledContractCborAuxdata element keys start from '1'.
      // So key is effectively i + 1
      const auxdataKey = i + 1;

      // If we already mapped this compilerAuxdataDiff, skip
      if (resultAuxdatas[auxdataKey] !== undefined) continue;

      // If in position `pos` of the originalBytecode we find the `compilerAuxdataDiff.real` value
      if (
        bytecodeIncludesCompilerAuxdataDiffAt(
          originalBytecode,
          compilerAuxdataDiff,
          pos,
        )
      ) {
        // Store the CompiledContractCborAuxdata element
        resultAuxdatas[auxdataKey] = {
          offset: (pos - compilerAuxdataDiff.diffStart - 2) / 2,
          value: `0x${compilerAuxdataDiff.real}`,
        };
        // Match the first auxdata for each bytecodeDiffPosition. If there are multiple identical cborAuxdata,
        // without the break it will always match the last one. With first, it will be "mapped" in the `result[resultIndex]`
        // See https://github.com/ethereum/sourcify/issues/1980
        break;
      }
    }

    prevPos = pos;
  }

  return resultAuxdatas;
}
