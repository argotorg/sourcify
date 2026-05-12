import type {
  AnyCompilation,
  CompilationTarget,
  ISolidityCompiler,
  IZkSolcCompiler,
  IVyperCompiler,
  IFeCompiler,
} from "@ethereum-sourcify/lib-sourcify";
import {
  CompilationError,
  SolidityCompilation,
  ZkSolcCompilation,
  VyperCompilation,
  YulCompilation,
  FeCompilation,
} from "@ethereum-sourcify/lib-sourcify";
import type {
  AnyJsonInput,
  SolidityJsonInput,
  VyperJsonInput,
  FeJsonInput,
} from "@ethereum-sourcify/compilers-types";

export function createCompilationFromJsonInput(
  compilers: {
    solc: ISolidityCompiler;
    zksolc?: IZkSolcCompiler;
    vyper: IVyperCompiler;
    fe: IFeCompiler;
  },
  compilerVersion: string,
  jsonInput: AnyJsonInput,
  compilationTarget: CompilationTarget,
  zksolcVersion?: string,
): AnyCompilation {
  switch (jsonInput?.language) {
    case "Solidity": {
      if (zksolcVersion) {
        if (!compilers.zksolc) {
          throw new CompilationError({ code: "invalid_language" });
        }

        return new ZkSolcCompilation(
          compilers.zksolc,
          zksolcVersion,
          compilerVersion,
          jsonInput as SolidityJsonInput,
          compilationTarget,
        );
      }

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
    case "Fe": {
      return new FeCompilation(
        compilers.fe,
        compilerVersion,
        jsonInput as FeJsonInput,
        compilationTarget,
      );
    }
    default: {
      throw new CompilationError({ code: "invalid_language" });
    }
  }
}
