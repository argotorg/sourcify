import type {
  IVyperCompiler,
  VyperJsonInput,
  VyperOutput,
  VyperStorageLayout,
} from "@ethereum-sourcify/lib-sourcify";
import {
  useVyperCompiler,
  useVyperStorageLayout,
} from "@ethereum-sourcify/compilers";

export class VyperLocal implements IVyperCompiler {
  constructor(private vyperRepoPath: string) {}

  async compile(
    version: string,
    vyperJsonInput: VyperJsonInput,
  ): Promise<VyperOutput> {
    return await useVyperCompiler(this.vyperRepoPath, version, vyperJsonInput);
  }

  async extractStorageLayout(
    version: string,
    vyperJsonInput: VyperJsonInput,
    targetPath: string,
  ): Promise<VyperStorageLayout> {
    return await useVyperStorageLayout(
      this.vyperRepoPath,
      version,
      vyperJsonInput,
      targetPath,
    );
  }
}
