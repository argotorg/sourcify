import type {
  IZkSolcCompiler,
  SolidityJsonInput,
  SolidityOutput,
} from "@ethereum-sourcify/lib-sourcify";
import { useZkSolcCompiler } from "@ethereum-sourcify/compilers";

export class ZkSolcLocal implements IZkSolcCompiler {
  constructor(
    private zksolcRepoPath: string,
    private eraSolcRepoPath: string,
  ) {}

  async compile(
    zksolcVersion: string,
    solcVersion: string,
    solcJsonInput: SolidityJsonInput,
  ): Promise<SolidityOutput> {
    return await useZkSolcCompiler(
      this.zksolcRepoPath,
      this.eraSolcRepoPath,
      zksolcVersion,
      solcVersion,
      solcJsonInput,
    );
  }
}
