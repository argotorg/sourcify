import type {
  MetadataCompilerSettings,
  SoliditySettings,
} from '@ethereum-sourcify/compilers-types';
import type { CompilationLanguage } from './CompilationTypes';
import { SolidityCompilation } from './SolidityCompilation';
import { id as keccak256str } from 'ethers';
import { convertLibrariesToMetadataFormat } from '../utils/utils';

/**
 * Abstraction of a Yul compilation
 */
export class YulCompilation extends SolidityCompilation {
  public language: CompilationLanguage = 'Yul';

  public async compile(forceEmscripten = false) {
    await this.compileAndReturnCompilationTarget(forceEmscripten);
    this.generateMetadata();
  }

  /**
   * Yul compiler does not produce a metadata but we generate it ourselves for backward
   * compatibility reasons e.g. in the legacy Sourcify API that always assumes a metadata.json
   */
  generateMetadata() {
    const contract = this.contractCompilerOutput;
    const outputMetadata = {
      abi: contract.abi,
      devdoc: contract.devdoc,
      userdoc: contract.userdoc,
    };

    const sourcesWithHashes = Object.entries(this.jsonInput.sources).reduce(
      (acc, [path, source]) => ({
        ...acc,
        [path]: {
          keccak256: keccak256str(source.content),
        },
      }),
      {},
    );

    const soliditySettings = JSON.parse(
      JSON.stringify(this.jsonInput.settings),
    ) as SoliditySettings;

    const metadataSettings: Omit<
      MetadataCompilerSettings,
      'compilationTarget'
    > & { outputSelection: undefined } = {
      ...soliditySettings,
      outputSelection: undefined,
      libraries: convertLibrariesToMetadataFormat(
        this.jsonInput.settings.libraries,
      ),
    };
    this._metadata = {
      compiler: { version: this.compilerVersion },
      language: 'Yul',
      output: outputMetadata,
      settings: {
        ...metadataSettings,
        compilationTarget: {
          [this.compilationTarget.path]: this.compilationTarget.name,
        },
      },
      sources: sourcesWithHashes,
      version: 1,
    };
  }
}
