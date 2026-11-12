import type {
  AnyCompilation,
  CompilationTarget,
  ISolidityCompiler,
  IVyperCompiler,
  IFeCompiler,
  ISolarCompiler,
  ISlangCompiler,
} from "@ethereum-sourcify/lib-sourcify";
import {
  CompilationError,
  SolidityCompilation,
  VyperCompilation,
  YulCompilation,
  FeCompilation,
  SolarCompilation,
  SlangCompilation,
  isSolarVersion,
  isSlangVersion,
} from "@ethereum-sourcify/lib-sourcify";
import type {
  AnyJsonInput,
  SlangJsonInput,
  SolarJsonInput,
  SolidityJsonInput,
  VyperJsonInput,
  FeJsonInput,
} from "@ethereum-sourcify/compilers-types";

export function createCompilationFromJsonInput(
  compilers: {
    solc: ISolidityCompiler;
    vyper: IVyperCompiler;
    fe: IFeCompiler;
    solar: ISolarCompiler;
    slang: ISlangCompiler;
  },
  compilerVersion: string,
  jsonInput: AnyJsonInput,
  compilationTarget: CompilationTarget,
): AnyCompilation {
  switch (jsonInput?.language) {
    case "Solidity": {
      // Solar compiles Solidity too, its version names the Solar build
      if (isSolarVersion(compilerVersion)) {
        return new SolarCompilation(
          compilers.solar,
          compilerVersion,
          jsonInput as SolarJsonInput,
          compilationTarget,
        );
      }
      // Slang too, its version ends with +slang
      if (isSlangVersion(compilerVersion)) {
        return new SlangCompilation(
          compilers.slang,
          compilerVersion,
          jsonInput as SlangJsonInput,
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
