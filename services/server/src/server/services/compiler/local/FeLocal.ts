import type {
  IFeCompiler,
  FeJsonInput,
  FeOutput,
} from "@ethereum-sourcify/lib-sourcify";
import { useFeCompiler } from "@ethereum-sourcify/compilers";

export class FeLocal implements IFeCompiler {
  constructor(private feRepoPath: string) {}

  async compile(version: string, feJsonInput: FeJsonInput): Promise<FeOutput> {
    return await useFeCompiler(this.feRepoPath, version, feJsonInput);
  }
}
