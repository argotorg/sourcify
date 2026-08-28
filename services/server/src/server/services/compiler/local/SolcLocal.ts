import type {
  CompilationTarget,
  StorageLayout,
  SolidityOutput,
  ISolidityCompiler,
  SolidityJsonInput,
} from "@ethereum-sourcify/lib-sourcify";
import {
  generateHistoricalSolidityStorageLayout,
  useSolidityCompiler,
} from "@ethereum-sourcify/compilers";

export class SolcLocal implements ISolidityCompiler {
  constructor(
    private solcRepoPath: string,
    private solJsonRepoPath: string,
    private timeoutMs?: number,
  ) {}

  async compile(
    version: string,
    solcJsonInput: SolidityJsonInput,
    forceEmscripten: boolean = false,
  ): Promise<SolidityOutput> {
    return await useSolidityCompiler(
      this.solcRepoPath,
      this.solJsonRepoPath,
      version,
      solcJsonInput,
      forceEmscripten,
      this.timeoutMs,
    );
  }

  async extractStorageLayout(
    version: string,
    solcJsonInput: SolidityJsonInput,
    compilerOutput: SolidityOutput,
    compilationTarget: CompilationTarget,
  ): Promise<StorageLayout | undefined> {
    return generateHistoricalSolidityStorageLayout(
      version,
      solcJsonInput,
      compilerOutput,
      compilationTarget,
    );
  }
}
