import type {
  ISlangCompiler,
  SlangJsonInput,
  SlangOutput,
} from "@ethereum-sourcify/lib-sourcify";
import { useSlangCompiler } from "@ethereum-sourcify/compilers";

export class SlangLocal implements ISlangCompiler {
  constructor(
    private slangRepoPath: string,
    private timeoutMs?: number,
  ) {}

  async compile(
    version: string,
    slangJsonInput: SlangJsonInput,
  ): Promise<SlangOutput> {
    return await useSlangCompiler(
      this.slangRepoPath,
      version,
      slangJsonInput,
      this.timeoutMs,
    );
  }
}
