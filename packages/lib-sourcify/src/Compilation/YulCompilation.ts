import type { CompilationLanguage } from './CompilationTypes';
import { SolidityCompilation } from './SolidityCompilation';

/**
 * Abstraction of a Yul compilation
 */
export class YulCompilation extends SolidityCompilation {
  public language: CompilationLanguage = 'Yul';

  public async compile(forceEmscripten = false) {
    await this.compileAndReturnCompilationTarget(forceEmscripten);
  }
}
