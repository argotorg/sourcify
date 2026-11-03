import { expect } from "chai";
import type {
  ISolarCompiler,
  ISolidityCompiler,
  IVyperCompiler,
  IFeCompiler,
  SolidityJsonInput,
} from "@ethereum-sourcify/lib-sourcify";
import {
  SolarCompilation,
  SolidityCompilation,
} from "@ethereum-sourcify/lib-sourcify";
import { createCompilationFromJsonInput } from "../../../src/server/services/utils/compilation";

// The factory only stores the compilers, it never calls them here
const compilers = {
  solc: {} as ISolidityCompiler,
  vyper: {} as IVyperCompiler,
  fe: {} as IFeCompiler,
  solar: {} as ISolarCompiler,
};

const jsonInput: SolidityJsonInput = {
  language: "Solidity",
  sources: { "A.sol": { content: "contract A {}" } },
  settings: {},
};

describe("createCompilationFromJsonInput", () => {
  it("uses Solar when the version names a Solar build", () => {
    const compilation = createCompilationFromJsonInput(
      compilers,
      "0.8.38+commit.e7a91fc7.solar.0.3.0",
      jsonInput,
      { path: "A.sol", name: "A" },
    );
    expect(compilation).to.be.instanceOf(SolarCompilation);
    expect(compilation.compiler).to.equal(compilers.solar);
  });

  it("uses solc for a solc version", () => {
    const compilation = createCompilationFromJsonInput(
      compilers,
      "0.8.28+commit.7893614a",
      jsonInput,
      { path: "A.sol", name: "A" },
    );
    expect(compilation).to.be.instanceOf(SolidityCompilation);
    expect(compilation).to.not.be.instanceOf(SolarCompilation);
    expect(compilation.compiler).to.equal(compilers.solc);
  });
});
