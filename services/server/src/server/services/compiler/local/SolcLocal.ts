import {
  SolidityOutput,
  ISolidityCompiler,
  SolidityJsonInput,
} from "@ethereum-sourcify/lib-sourcify";
import { useSolidityCompiler } from "@ethereum-sourcify/compilers";

export class SolcLocal implements ISolidityCompiler {
  constructor(
    private solcRepoPath: string,
    private solJsonRepoPath: string,
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
    );
  }
}
