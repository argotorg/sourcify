import type {
  IVyperCompiler,
  VyperJsonInput,
  VyperOutput,
  VyperStorageLayout,
  VyperStorageLayouts,
} from "@ethereum-sourcify/lib-sourcify";
import {
  useVyperCompiler,
  useVyperStorageLayout,
  useVyperStorageLayouts,
} from "@ethereum-sourcify/compilers";

export class VyperLocal implements IVyperCompiler {
  constructor(
    private vyperRepoPath: string,
    private timeoutMs?: number,
  ) {}

  async compile(
    version: string,
    vyperJsonInput: VyperJsonInput,
  ): Promise<VyperOutput> {
    return await useVyperCompiler(
      this.vyperRepoPath,
      version,
      vyperJsonInput,
      this.timeoutMs,
    );
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

  async extractStorageLayouts(
    version: string,
    vyperJsonInput: VyperJsonInput,
    targetPath: string,
  ): Promise<VyperStorageLayouts> {
    return await useVyperStorageLayouts(
      this.vyperRepoPath,
      version,
      vyperJsonInput,
      targetPath,
    );
  }
}
