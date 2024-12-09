import dirTree from "directory-tree";
import Path from "path";
import fs from "fs";
import {
  Match,
  Status,
  StringMap,
  AbstractCheckedContract,
} from "@ethereum-sourcify/lib-sourcify";
import {
  ContractData,
  FileObject,
  FilesInfo,
  MatchLevel,
  MatchLevelWithoutAny,
  MatchQuality,
  PathConfig,
} from "../../types";
import path from "path";
import logger from "../../../common/logger";
import { getAddress } from "ethers";
import { getMatchStatus } from "../../common";
import { RWStorageService } from "../StorageService";
import { RWStorageIdentifiers } from "./identifiers";
import { exists, readFile } from "../utils/util";

export interface RepositoryV1ServiceOptions {
  repositoryPath: string;
}

export class RepositoryV1Service implements RWStorageService {
  IDENTIFIER = RWStorageIdentifiers.RepositoryV1;
  repositoryPath: string;
  serverUrl: string;

  constructor(options: RepositoryV1ServiceOptions, serverUrl: string) {
    this.repositoryPath = options.repositoryPath;
    this.serverUrl = serverUrl;
  }

  async getFile(
    chainId: string,
    address: string,
    match: MatchLevelWithoutAny,
    path: string,
  ): Promise<string | false> {
    return await readFile(this.repositoryPath, match, chainId, address, path);
  }

  async init() {
    logger.info(`${this.IDENTIFIER} initialized`, {
      repositoryPath: this.repositoryPath,
    });
    return true;
  }

  fetchAllFileUrls(
    chain: string,
    address: string,
    match = "full_match",
  ): Array<string> {
    const files: Array<FileObject> = this.fetchAllFilePaths(
      chain,
      address,
      match,
    );
    const urls: Array<string> = [];
    files.forEach((file) => {
      const relativePath = file.path.replace(this.repositoryPath, "");
      urls.push(`${this.serverUrl}/repository/${relativePath}`);
    });
    return urls;
  }

  /**
   * Returns all the files under the given chain and address directory.
   *
   * @param chain
   * @param address
   * @param match
   * @returns FileObject[]
   *
   * @example [
   *   { name: '0x1234.sol',
   *     path: '/contracts/full_match/1/0x1234/0x1234.sol,
   *     content: "pragma solidity ^0.5.0; contract A { ... }"
   *   },
   * ... ]
   */
  fetchAllFilePaths(
    chain: string,
    address: string,
    match = "full_match",
  ): Array<FileObject> {
    const fullPath = Path.join(
      this.repositoryPath,
      "contracts",
      match,
      chain,
      getAddress(address),
    );
    const files: Array<FileObject> = [];
    dirTree(fullPath, {}, (item) => {
      files.push({ name: item.name, path: item.path });
    });
    return files;
  }

  async fetchAllFileContents(
    chain: string,
    address: string,
    match = "full_match",
  ): Promise<Array<FileObject>> {
    const files = this.fetchAllFilePaths(chain, address, match);
    for (const file in files) {
      const loadedFile = await fs.promises.readFile(files[file].path);
      files[file].content = loadedFile.toString();
      files[file].path = files[file].path.replace(this.repositoryPath, "");
    }

    return files;
  }

  fetchAllContracts = async (chain: string): Promise<ContractData> => {
    const fullPath = Path.join(
      this.repositoryPath,
      "contracts",
      "full_match",
      chain,
    );

    const partialPath = Path.join(
      this.repositoryPath,
      "contracts",
      "partial_match",
      chain,
    );

    const full = (await exists(fullPath))
      ? await fs.promises.readdir(fullPath)
      : [];
    const partial = (await exists(partialPath))
      ? await fs.promises.readdir(partialPath)
      : [];
    return {
      full,
      partial,
    };
  };

  getTree = async (
    chainId: string,
    address: string,
    match: MatchLevel,
  ): Promise<FilesInfo<string[]>> => {
    const fullMatchesTree = this.fetchAllFileUrls(
      chainId,
      address,
      "full_match",
    );
    if (fullMatchesTree.length || match === "full_match") {
      return { status: "full", files: fullMatchesTree };
    }

    const files = this.fetchAllFileUrls(chainId, address, "partial_match");
    return { status: "partial", files };
  };

  getContent = async (
    chainId: string,
    address: string,
    match: MatchLevel,
  ): Promise<FilesInfo<Array<FileObject>>> => {
    const fullMatchesFiles = await this.fetchAllFileContents(
      chainId,
      address,
      "full_match",
    );
    if (fullMatchesFiles.length || match === "full_match") {
      return { status: "full", files: fullMatchesFiles };
    }

    const files = await this.fetchAllFileContents(
      chainId,
      address,
      "partial_match",
    );
    return { status: "partial", files };
  };

  getContracts = async (chainId: string): Promise<ContractData> => {
    const contracts = await this.fetchAllContracts(chainId);
    return contracts;
  };

  // /home/user/sourcify/data/repository/contracts/full_match/5/0x00878Ac0D6B8d981ae72BA7cDC967eA0Fae69df4/sources/filename
  public generateAbsoluteFilePath(pathConfig: PathConfig) {
    return Path.join(
      this.repositoryPath,
      this.generateRelativeFilePath(pathConfig),
    );
  }

  // contracts/full_match/5/0x00878Ac0D6B8d981ae72BA7cDC967eA0Fae69df4/sources/filename
  public generateRelativeFilePath(pathConfig: PathConfig) {
    return Path.join(
      this.generateRelativeContractDir(pathConfig),
      pathConfig.source ? "sources" : "",
      pathConfig.fileName || "",
    );
  }

  // contracts/full_match/5/0x00878Ac0D6B8d981ae72BA7cDC967eA0Fae69df4
  public generateRelativeContractDir(pathConfig: PathConfig) {
    return Path.join(
      "contracts",
      `${pathConfig.matchQuality}_match`,
      pathConfig.chainId,
      getAddress(pathConfig.address),
    );
  }

  /**
   * Checks if path exists and for a particular chain returns the perfect or partial match
   *
   * @param fullContractPath
   * @param partialContractPath
   */
  async fetchFromStorage(
    fullContractPath: string,
    partialContractPath: string,
  ): Promise<{ time: Date; status: Status }> {
    try {
      await fs.promises.access(fullContractPath);
      return {
        time: (await fs.promises.stat(fullContractPath)).birthtime,
        status: "perfect",
      };
    } catch (e) {
      // Do nothing
    }

    try {
      await fs.promises.access(partialContractPath);
      return {
        time: (await fs.promises.stat(partialContractPath)).birthtime,
        status: "partial",
      };
    } catch (e) {
      // Do nothing
    }

    throw new Error(
      `Path not found: ${fullContractPath} or ${partialContractPath}`,
    );
  }

  // Checks contract existence in repository.
  async checkByChainAndAddress(
    address: string,
    chainId: string,
  ): Promise<Match[]> {
    logger.silly("RepositoryV1.checkByChainAndAddress", {
      chainId,
      address,
    });

    const contractPath = this.generateAbsoluteFilePath({
      matchQuality: "full",
      chainId,
      address,
      fileName: "metadata.json",
    });

    try {
      const storageTimestamp = (await fs.promises.stat(contractPath)).birthtime;
      logger.debug("Found full match in RepositoryV1", {
        chainId,
        address,
        storageTimestamp,
      });
      return [
        {
          address,
          chainId,
          runtimeMatch: "perfect",
          creationMatch: null,
          storageTimestamp,
        },
      ];
    } catch (e: any) {
      logger.silly("Couldn't find full match in RepositoryV1", {
        address,
        chainId,
        error: e.message,
      });
      return [];
    }
  }

  // Checks contract existence in repository for full and partial matches.
  async checkAllByChainAndAddress(
    address: string,
    chainId: string,
  ): Promise<Match[]> {
    logger.silly("RepositoryV1.checkAllByChainAndAddress", {
      chainId,
      address,
    });

    const fullContractPath = this.generateAbsoluteFilePath({
      matchQuality: "full",
      chainId,
      address,
      fileName: "metadata.json",
    });

    const partialContractPath = this.generateAbsoluteFilePath({
      matchQuality: "partial",
      chainId,
      address,
      fileName: "metadata.json",
    });

    try {
      const storage = await this.fetchFromStorage(
        fullContractPath,
        partialContractPath,
      );

      logger.debug("Found full or partial match in RepositoryV1", {
        chainId,
        address,
        storageTimestamp: storage.time,
        storageStatus: storage.status,
      });
      return [
        {
          address,
          chainId,
          runtimeMatch: storage?.status,
          creationMatch: storage?.status,
          storageTimestamp: storage?.time,
        },
      ];
    } catch (e: any) {
      logger.silly("Couldn't find full or partial match in RepositoryV1", {
        address,
        chainId,
        error: e.message,
      });
      return [];
    }
  }

  /**
   * Save file to repository and update the repository tag. The path may include non-existent parent directories.
   *
   * @param path the path within the repository where the file will be stored
   * @param content the content to be stored
   */
  async save(path: PathConfig, content: string) {
    const abolsutePath = this.generateAbsoluteFilePath(path);
    await fs.promises.mkdir(Path.dirname(abolsutePath), { recursive: true });
    await fs.promises.writeFile(abolsutePath, content);
    logger.silly("Saved file to repositoryV1", { abolsutePath });
  }

  public async storeMatch(
    contract: AbstractCheckedContract,
    match: Match,
  ): Promise<void | Match> {
    if (
      match.address &&
      (match.runtimeMatch === "perfect" ||
        match.runtimeMatch === "partial" ||
        match.creationMatch === "perfect" ||
        match.creationMatch === "partial")
    ) {
      // Delete the partial matches if we now have a perfect match instead.
      if (
        match.runtimeMatch === "perfect" ||
        match.creationMatch === "perfect"
      ) {
        await this.deletePartialIfExists(match.chainId, match.address);
      }
      const matchQuality: MatchQuality = this.statusToMatchQuality(
        getMatchStatus(match),
      );

      await this.storeSources(
        matchQuality,
        match.chainId,
        match.address,
        contract.sources,
      );

      // Store metadata
      await this.storeJSON(
        matchQuality,
        match.chainId,
        match.address,
        "metadata.json",
        contract.metadata,
      );

      if (match.abiEncodedConstructorArguments) {
        await this.storeTxt(
          matchQuality,
          match.chainId,
          match.address,
          "constructor-args.txt",
          match.abiEncodedConstructorArguments,
        );
      }

      if (match.creatorTxHash) {
        await this.storeTxt(
          matchQuality,
          match.chainId,
          match.address,
          "creator-tx-hash.txt",
          match.creatorTxHash,
        );
      }

      if (match.libraryMap && Object.keys(match.libraryMap).length) {
        await this.storeJSON(
          matchQuality,
          match.chainId,
          match.address,
          "library-map.json",
          match.libraryMap,
        );
      }

      if (
        match.immutableReferences &&
        Object.keys(match.immutableReferences).length > 0
      ) {
        await this.storeJSON(
          matchQuality,
          match.chainId,
          match.address,
          "immutable-references.json",
          match.immutableReferences,
        );
      }

      logger.info("Stored contract to RepositoryV1", {
        address: match.address,
        chainId: match.chainId,
        name: contract.name,
        runtimeMatch: match.runtimeMatch,
        creationMatch: match.creationMatch,
      });
    } else if (match.runtimeMatch === "extra-file-input-bug") {
      return match;
    } else {
      throw new Error(`Unknown match status: ${match.runtimeMatch}`);
    }
  }

  async deletePartialIfExists(chainId: string, address: string) {
    const pathConfig: PathConfig = {
      matchQuality: "partial",
      chainId,
      address,
      fileName: "",
    };
    const absolutePath = this.generateAbsoluteFilePath(pathConfig);

    if (await exists(absolutePath)) {
      await fs.promises.rm(absolutePath, { recursive: true });
    }
  }

  /**
   * This method exists because many different people have contributed to this code, which has led to the
   * lack of unanimous nomenclature
   * @param status
   * @returns {MatchQuality} matchQuality
   */
  private statusToMatchQuality(status: Status): MatchQuality {
    if (status === "perfect") return "full";
    if (status === "partial") return status;
    throw new Error(`Invalid match status: ${status}`);
  }

  private async storeSources(
    matchQuality: MatchQuality,
    chainId: string,
    address: string,
    sources: StringMap,
  ) {
    const pathTranslation: StringMap = {};
    for (const sourcePath in sources) {
      const { sanitizedPath, originalPath } = this.sanitizePath(sourcePath);
      if (sanitizedPath !== originalPath) {
        pathTranslation[originalPath] = sanitizedPath;
      }
      await this.save(
        {
          matchQuality,
          chainId,
          address,
          source: true,
          fileName: sanitizedPath,
        },
        sources[sourcePath],
      );
    }
    // Finally save the path translation
    if (Object.keys(pathTranslation).length === 0) return;
    await this.save(
      {
        matchQuality,
        chainId,
        address,
        source: false,
        fileName: "path-translation.json",
      },
      JSON.stringify(pathTranslation),
    );
  }

  private async storeJSON(
    matchQuality: MatchQuality,
    chainId: string,
    address: string,
    fileName: string,
    contentJSON: any,
  ) {
    await this.save(
      {
        matchQuality,
        chainId,
        address,
        fileName,
      },
      JSON.stringify(contentJSON),
    );
  }

  private async storeTxt(
    matchQuality: MatchQuality,
    chainId: string,
    address: string,
    fileName: string,
    content: string,
  ) {
    await this.save(
      {
        matchQuality,
        chainId,
        address,
        source: false,
        fileName,
      },
      content,
    );
  }

  private sanitizePath(originalPath: string) {
    // Clean ../ and ./ from the path. Also collapse multiple slashes into one.
    let sanitizedPath = path.normalize(originalPath);

    // Replace \n case not addressed by `path.normalize`
    sanitizedPath = sanitizedPath.replace(/\n/g, "");

    // If there are no upper folders to traverse, path.normalize will keep ../ parts. Need to remove any of those.
    const parsedPath = path.parse(sanitizedPath);
    const sanitizedDir = parsedPath.dir
      .split(path.sep)
      .filter((segment) => segment !== "..")
      .join(path.sep);

    // Force absolute paths to be relative
    if (parsedPath.root) {
      parsedPath.dir = sanitizedDir.slice(parsedPath.root.length);
      parsedPath.root = "";
    } else {
      parsedPath.dir = sanitizedDir;
    }

    sanitizedPath = path.format(parsedPath);
    return { sanitizedPath, originalPath };
  }
}
