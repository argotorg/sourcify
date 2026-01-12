import type {
  AnyCompilation,
  CompilationTarget,
  ISolidityCompiler,
  IVyperCompiler,
} from "@ethereum-sourcify/lib-sourcify";
import {
  CompilationError,
  SolidityCompilation,
  VyperCompilation,
  YulCompilation,
} from "@ethereum-sourcify/lib-sourcify";
import type {
  AnyJsonInput,
  SolidityJsonInput,
  VyperJsonInput,
} from "@ethereum-sourcify/compilers-types";

export function createCompilationFromJsonInput(
  compilers: {
    solc: ISolidityCompiler;
    vyper: IVyperCompiler;
  },
  compilerVersion: string,
  jsonInput: AnyJsonInput,
  compilationTarget: CompilationTarget,
): AnyCompilation {
  switch (jsonInput?.language) {
    case "Solidity": {
      return new SolidityCompilation(
        compilers.solc,
        compilerVersion,
        jsonInput as SolidityJsonInput,
        compilationTarget,
      );
    }
    case "Yul": {
      return new YulCompilation(
        compilers.solc,
        compilerVersion,
        jsonInput as SolidityJsonInput,
        compilationTarget,
      );
    }
    case "Vyper": {
      return new VyperCompilation(
        compilers.vyper,
        compilerVersion,
        jsonInput as VyperJsonInput,
        compilationTarget,
      );
    }
    default: {
      throw new CompilationError({ code: "invalid_language" });
    }
  }
}
