import { SolidityOutput, ISolidityCompiler, SolidityJsonInput} from "@ethereum-sourcify/lib-sourcify";
import { useSolidityCompiler } from "@ethereum-sourcify/compilers";

export class SolcLocal implements ISolidityCompiler {
  constructor(
    public solcRepoPath: string,
    public solJsonRepoPath: string,
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
