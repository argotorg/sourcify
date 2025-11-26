import type {
  AnyJsonInput,
  SolidityJsonInput,
  VyperJsonInput,
} from '@ethereum-sourcify/compilers-types';
import { SolidityCompilation } from './SolidityCompilation';
import { VyperCompilation } from './VyperCompilation';
import {
  CompilationError,
  type AnyCompilation,
  type CompilationTarget,
  type ISolidityCompiler,
  type IVyperCompiler,
} from './CompilationTypes';
import { YulCompilation } from './YulCompilation';

export function createCompilationFromJsonInput(
  compilers: {
    solc: ISolidityCompiler;
    vyper: IVyperCompiler;
  },
  compilerVersion: string,
  jsonInput: AnyJsonInput,
  compilationTarget: CompilationTarget,
) {
  let compilation: AnyCompilation;
  switch (jsonInput?.language) {
    case 'Solidity': {
      compilation = new SolidityCompilation(
        compilers.solc,
        compilerVersion,
        jsonInput as SolidityJsonInput,
        compilationTarget,
      );
      break;
    }
    case 'Yul': {
      compilation = new YulCompilation(
        compilers.solc,
        compilerVersion,
        jsonInput as SolidityJsonInput,
        compilationTarget,
      );
      break;
    }
    case 'Vyper': {
      compilation = new VyperCompilation(
        compilers.vyper,
        compilerVersion,
        jsonInput as VyperJsonInput,
        compilationTarget,
      );
      break;
    }
    default: {
      throw new CompilationError({ code: 'invalid_language' });
    }
  }
  return compilation;
}
