import type {
  ISolarCompiler,
  SolarJsonInput,
  SolarOutput,
} from "@ethereum-sourcify/lib-sourcify";
import { useSolarCompiler } from "@ethereum-sourcify/compilers";

export class SolarLocal implements ISolarCompiler {
  constructor(
    private solarRepoPath: string,
    private timeoutMs?: number,
  ) {}

  async compile(
    version: string,
    solarJsonInput: SolarJsonInput,
  ): Promise<SolarOutput> {
    return await useSolarCompiler(
      this.solarRepoPath,
      version,
      solarJsonInput,
      this.timeoutMs,
    );
  }
}
