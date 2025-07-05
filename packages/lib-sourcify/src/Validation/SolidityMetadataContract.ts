import { id as keccak256str } from 'ethers';
import semver from 'semver';
import { performFetch } from './fetchUtils';
import { SolidityCompilation } from '../Compilation/SolidityCompilation';
import {
  Libraries,
  SolidityJsonInput,
  Metadata,
  MetadataCompilerSettings,
  MetadataSourceMap,
} from '@ethereum-sourcify/compilers-types';
import { ISolidityCompiler, StringMap } from '../Compilation/CompilationTypes';
import {
  InvalidSources,
  IpfsGateway,
  MissingSources,
  PathContent,
  ValidationError,
} from './ValidationTypes';
import {
  AuxdataStyle,
  decode as decodeBytecode,
} from '@ethereum-sourcify/bytecode-utils';
import { ipfsHash } from './hashFunctions/ipfsHash';
import { swarmBzzr1Hash, swarmBzzr0Hash } from './hashFunctions/swarmHash';
import {
  generateVariations,
  groupBy,
  reorderAlphabetically,
  getVariationsByContentHash,
} from './variationsUtils';
import { logDebug } from '../logger';
import { splitFullyQualifiedName } from '../utils';

export class SolidityMetadataContract {
  metadata: Metadata;
  name: string;
  path: string;
  providedSources: PathContent[];
  providedSourcesByHash: Map<string, PathContent>;
  foundSources: StringMap;
  missingSources: MissingSources;
  invalidSources: InvalidSources;
  unusedSourceFiles: string[];
  metadataPathToProvidedFilePath: StringMap; // maps the file path as in metadata.sources to the path of the provided by the user. E.g. metadata can have "contracts/1_Storage.sol" but the user provided "/Users/user/project/contracts/1_Storage.sol"
  compilation: SolidityCompilation | null;
  solcJsonInput: SolidityJsonInput | null;

  // Static IPFS gateway configuration
  private static ipfsGateway: IpfsGateway = {
    url: 'https://ipfs.io/ipfs/',
  };

  // Static method to set the IPFS gateway
  public static setGlobalIpfsGateway(gateway: IpfsGateway): void {
    SolidityMetadataContract.ipfsGateway = gateway;
  }

  public static getGlobalIpfsGateway(): IpfsGateway {
    return SolidityMetadataContract.ipfsGateway;
  }

  constructor(metadata: Metadata, providedSources: PathContent[]) {
    this.metadata = structuredClone(metadata);
    // These are assigned in `assembleContract`
    this.foundSources = {};
    this.missingSources = {};
    this.invalidSources = {};
    this.unusedSourceFiles = [];
    this.metadataPathToProvidedFilePath = {};
    this.compilation = null;
    this.solcJsonInput = null;

    const compilationTargetPath = Object.keys(
      metadata.settings.compilationTarget,
    )[0];
    this.path = compilationTargetPath;
    this.name = metadata.settings.compilationTarget[compilationTargetPath];
    this.providedSources = providedSources;
    this.providedSourcesByHash = this.storeByHash(providedSources);
    this.assembleContract();
    if (this.isCompilable()) {
      this.createJsonInputFromMetadata();
    }
  }

  async createCompilation(compiler: ISolidityCompiler) {
    if (Object.keys(this.missingSources).length > 0) {
      await this.fetchMissing();
    }

    this.createJsonInputFromMetadata();

    this.compilation = new SolidityCompilation(
      compiler,
      this.metadata.compiler.version,
      this.solcJsonInput!,
      {
        path: this.path,
        name: this.name,
      },
    );

    return this.compilation;
  }

  /**
   * Generates a map of files indexed by the keccak hash of their content.
   *
   */
  storeByHash(files: PathContent[]): Map<string, PathContent> {
    const byHash: Map<string, PathContent> = new Map();

    for (const pathContent of files) {
      const calculatedHash = keccak256str(pathContent.content);
      byHash.set(calculatedHash, pathContent);
    }

    return byHash;
  }

  generateSourceVariations() {
    for (const pathContent of this.providedSources) {
      const variations = generateVariations(pathContent);
      for (const variation of variations) {
        const calculatedHash = keccak256str(variation.content);
        this.providedSourcesByHash.set(calculatedHash, variation);
      }
    }
  }

  /**
   * Assembles the contract by checking the sources in the metadata and finding them with the hash in the sourcesByHash map.
   * First optimistically tries to find the source in the provided sources. If not all found, it will generate variations of source files and try again.
   * Marks missing sources and invalid sources.
   */
  private assembleContract() {
    for (const sourcePath in this.metadata.sources) {
      const sourceInfoFromMetadata = this.metadata.sources[sourcePath];
      let file: PathContent | undefined = undefined;
      const expectedHash: string = sourceInfoFromMetadata.keccak256;
      if (sourceInfoFromMetadata.content) {
        // Source content already in metadata
        file = {
          content: sourceInfoFromMetadata.content,
          path: sourcePath,
        };
        const contentHash = keccak256str(file.content);
        if (contentHash != expectedHash) {
          this.invalidSources[sourcePath] = {
            expectedHash: expectedHash,
            calculatedHash: contentHash,
            msg: `The keccak256 given in the metadata and the calculated keccak256 of the source content in metadata don't match`,
          };
          continue;
        }
      } else {
        // Get source from input files by hash
        const pathContent = this.providedSourcesByHash.get(expectedHash);
        if (pathContent) {
          file = pathContent;
          this.metadataPathToProvidedFilePath[sourcePath] = pathContent.path;
        } // else: no file has the hash that was searched for
      }

      if (file && file.content) {
        this.foundSources[sourcePath] = file.content;
      } else {
        this.missingSources[sourcePath] = {
          keccak256: expectedHash,
          urls: sourceInfoFromMetadata.urls!,
        };
      }
    }

    // If there are still missing sources, generate variations of the provided sources and try again. We optimistically tried to find the source in the provided sources first.
    if (Object.keys(this.missingSources).length > 0) {
      this.generateSourceVariations();
      for (const missingSource in this.missingSources) {
        const missingKeccak = this.missingSources[missingSource].keccak256;
        const pathContent = this.providedSourcesByHash.get(missingKeccak);
        if (pathContent) {
          this.foundSources[missingSource] = pathContent.content;
          this.metadataPathToProvidedFilePath[missingSource] = pathContent.path;
          delete this.missingSources[missingSource];
        }
      }
    }

    // Finally, extract unused source files
    const usedFilePaths = Object.values(this.metadataPathToProvidedFilePath);
    const usedFilesSet = new Set(usedFilePaths);
    this.unusedSourceFiles = this.providedSources
      .map((pc) => pc.path)
      .filter((file) => !usedFilesSet.has(file));
  }

  /**
   * Asynchronously attempts to fetch the missing sources of this contract. An error is thrown in case of a failure.
   */
  async fetchMissing(): Promise<void> {
    const IPFS_PREFIX = 'dweb:/ipfs/';

    for (const fileName in this.missingSources) {
      const file = this.missingSources[fileName];
      const hash = file.keccak256;

      let retrievedContent = null;

      // Sometimes file paths are github urls, try to fetch from there
      if (fileName.includes('github.com')) {
        const githubUrl = fileName
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
        retrievedContent = await performFetch(githubUrl, hash, fileName);
      } else {
        for (const url of file.urls) {
          if (url.startsWith(IPFS_PREFIX)) {
            const ipfsCID = url.slice(IPFS_PREFIX.length);
            const ipfsUrl = SolidityMetadataContract.ipfsGateway.url + ipfsCID;
            retrievedContent = await performFetch(
              ipfsUrl,
              hash,
              fileName,
              SolidityMetadataContract.ipfsGateway.headers,
            );
            if (retrievedContent) {
              break;
            }
          }
        }
      }

      if (retrievedContent) {
        this.foundSources[fileName] = retrievedContent;
        delete this.missingSources[fileName];
      }
    }

    if (Object.keys(this.missingSources).length) {
      logDebug('Resource missing; unsuccessful fetching.', {
        missing: this.missingSources,
      });
      throw new ValidationError({
        code: 'missing_source',
        missingSources: Object.keys(this.missingSources),
      });
    }

    this.createJsonInputFromMetadata();
  }

  createJsonInputFromMetadata() {
    if (
      Object.keys(this.missingSources).length > 0 ||
      Object.keys(this.invalidSources).length > 0
    ) {
      logDebug(
        "Can't create JsonInput from metadata: Missing or invalid sources in metadata.",
        {
          missing: this.missingSources,
          invalid: this.invalidSources,
        },
      );
      throw new ValidationError({
        code: 'missing_or_invalid_source',
        missingSources: Object.keys(this.missingSources),
        invalidSources: Object.keys(this.invalidSources),
      });
    }

    this.solcJsonInput = {} as SolidityJsonInput;
    // Clone the settings object to avoid mutating the original metadata
    const settings = JSON.parse(
      JSON.stringify(this.metadata.settings),
    ) as MetadataCompilerSettings;

    // Remove libraries and compilationTarget before assigning
    const {
      libraries: metadataLibraries,
      compilationTarget,
      ...settingsWithoutLibraries
    } = settings;
    this.solcJsonInput.settings = {
      ...settingsWithoutLibraries,
      outputSelection: {}, // Output selection can be set to empty object because it's overwritten by SolidityCompilation
    };

    if (!compilationTarget || Object.keys(compilationTarget).length != 1) {
      logDebug(
        `Can't create JsonInput from metadata: Invalid compilationTarget in metadata`,
        {
          compilationTargets: Object.keys(
            this.metadata.settings.compilationTarget,
          ),
        },
      );
      throw new ValidationError({
        code: 'invalid_compilation_target',
        compilationTargets: Object.keys(
          this.metadata.settings.compilationTarget,
        ),
      });
    }

    this.handleInlinerBug();

    this.solcJsonInput.sources = {};
    for (const source in this.metadata.sources) {
      this.solcJsonInput.sources[source] = {
        content: this.foundSources[source],
      };
    }

    this.solcJsonInput.language = this.metadata.language;

    // Convert the libraries from the metadata format to the compiler_settings format
    // metadata format: "contracts/1_Storage.sol:Journal": "0x7d53f102f4d4aa014db4e10d6deec2009b3cda6b"
    // settings format: "contracts/1_Storage.sol": { Journal: "0x7d53f102f4d4aa014db4e10d6deec2009b3cda6b" }
    if (metadataLibraries) {
      this.solcJsonInput.settings.libraries = Object.keys(
        metadataLibraries,
      ).reduce((libraries, libraryKey) => {
        // Before Solidity v0.7.5: { "ERC20": "0x..."}
        if (!libraryKey.includes(':')) {
          if (!libraries['']) {
            libraries[''] = {};
          }
          // try using the global method, available for pre 0.7.5 versions
          libraries[''][libraryKey] = metadataLibraries[libraryKey];
          return libraries;
        }

        // After Solidity v0.7.5: { "ERC20.sol:ERC20": "0x..."}
        const { contractPath, contractName } =
          splitFullyQualifiedName(libraryKey);
        if (!libraries[contractPath]) {
          libraries[contractPath] = {};
        }
        libraries[contractPath][contractName] = metadataLibraries[libraryKey];
        return libraries;
      }, {} as Libraries);
    }
  }

  handleInlinerBug() {
    // Check inliner bug for below versions https://github.com/ethereum/sourcify/issues/640
    const affectedVersions = ['0.8.2', '0.8.3', '0.8.4'];
    // Normalize the version e.g. 0.8.2+commit.6615895f -> 0.8.2
    const coercedVersion = semver.coerce(
      this.metadata.compiler.version,
    )?.version;

    const isAffected = affectedVersions.some((version) =>
      semver.eq(version, coercedVersion || ''),
    );
    if (isAffected) {
      if (this.solcJsonInput?.settings?.optimizer?.details?.inliner) {
        delete this.solcJsonInput.settings.optimizer.details.inliner;
      }
    }
  }

  isCompilable() {
    return (
      Object.keys(this.missingSources).length === 0 &&
      Object.keys(this.invalidSources).length === 0
    );
  }

  /**
   * Function to try to generate variations of the metadata of the contract such that it will match to the hash in the onchain bytecode.
   * Generates variations of the given source files and replaces the hashes in the metadata with the hashes of the variations.
   * If found, replaces this.metadata and this.sources with the found variations.
   * Useful for finding perfect matches for known types of variations such as different line endings.
   *
   * @param runtimeBytecode
   * @returns true if perfect metadata is found, false otherwise
   */
  async tryToFindPerfectMetadata(runtimeBytecode: string): Promise<boolean> {
    let decodedAuxdata;
    try {
      decodedAuxdata = decodeBytecode(runtimeBytecode, AuxdataStyle.SOLIDITY);
    } catch (err) {
      // There is no auxdata at all in this contract
      return false;
    }

    const pathContent: PathContent[] = Object.keys(this.foundSources).map(
      (path) => {
        return {
          path,
          content: this.foundSources[path] || '',
        };
      },
    );

    const byHash = getVariationsByContentHash(pathContent);

    /*
     * getVariationsByContentHash returns a mapping like this one:
     * Map({
     *   keccak256str(variation.content): {
     *     content,
     *     path: pathContent.path,
     *     variation: contentVariator + '.' + endingVariator,
     *   }
     * })
     *
     * we need to group all the different files by variation:
     *
     * {
     *   "1.1": [
     *     {
     *       content,
     *       path: pathContent.path,
     *       variation: "1.1",
     *     },
     *     ...
     *   ],
     *   "1.2": [...]
     * }
     */
    const byVariation = groupBy(Array.from(byHash.values()), 'variation');

    // We should canonicalize the metadata when we are generating "metadata variations" when we have a partial match.
    // It could be that the user somehow mixed the orderings of the metadata or added whitespaces etc.
    // For more information read https://github.com/ethereum/sourcify/issues/978
    const metadata: Metadata = reorderAlphabetically(this.metadata) as Metadata;

    // For each variation
    // 1. replace: "keccak256" and "url" fields in the metadata with the hashes of the variation
    // 2. take the hash of the modified metadata
    // 3. Check if this will match the hash in the bytecode
    for (const sources of Object.values(byVariation)) {
      metadata.sources = sources.reduce(
        (sources: MetadataSourceMap, source) => {
          if (metadata.sources[source.path]) {
            sources[source.path] = metadata.sources[source.path];
            sources[source.path].keccak256 = keccak256str(source.content);
            if (sources[source.path].content) {
              sources[source.path].content = source.content;
            }
            if (sources[source.path].urls) {
              sources[source.path].urls = sources[source.path].urls?.map(
                (url: string) => {
                  if (url.includes('dweb:/ipfs/')) {
                    return `dweb:/ipfs/${ipfsHash(source.content)}`;
                  }
                  if (url.includes('bzz-raw://')) {
                    // Here swarmBzzr1Hash is always used
                    // https://github.com/ethereum/solidity/blob/eb2f874eac0aa871236bf5ff04b7937c49809c33/libsolidity/interface/CompilerStack.cpp#L1549
                    return `bzz-raw://${swarmBzzr1Hash(source.content)}`;
                  }
                  return '';
                },
              );
            }
          }
          return sources;
        },
        {},
      );

      if (decodedAuxdata?.ipfs) {
        const compiledMetadataIpfsCID = ipfsHash(JSON.stringify(metadata));
        if (decodedAuxdata?.ipfs === compiledMetadataIpfsCID) {
          this.metadata = metadata;
          this.foundSources = sources.reduce((acc, source) => {
            acc[source.path] = source.content;
            return acc;
          }, {} as StringMap);
          return true;
        }
      }
      if (decodedAuxdata?.bzzr1) {
        const compiledMetadataBzzr1 = swarmBzzr1Hash(JSON.stringify(metadata));
        if (decodedAuxdata?.bzzr1 === compiledMetadataBzzr1) {
          this.metadata = metadata;
          this.foundSources = sources.reduce((acc, source) => {
            acc[source.path] = source.content;
            return acc;
          }, {} as StringMap);
          return true;
        }
      }
      if (decodedAuxdata?.bzzr0) {
        const compiledMetadataBzzr0 = swarmBzzr0Hash(JSON.stringify(metadata));
        if (decodedAuxdata?.bzzr0 === compiledMetadataBzzr0) {
          this.metadata = metadata;
          this.foundSources = sources.reduce((acc, source) => {
            acc[source.path] = source.content;
            return acc;
          }, {} as StringMap);
          return true;
        }
      }
    }
    return false;
  }
}
