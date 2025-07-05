/**
 * This is a temporary service used only during the synchronization process.
 *
 * After the synchronization process, this service will be updated to point to
 * an external Repository Service.
 */

import Path from "path";
import fs from "fs";
import {
  VerificationStatus,
  StringMap,
  VerificationExport,
} from "@ethereum-sourcify/lib-sourcify";
import { V1MatchLevelWithoutAny, MatchQuality, PathConfig } from "../../types";
import logger from "../../../common/logger";
import { getAddress, id as keccak256 } from "ethers";
import { WStorageService } from "../StorageService";
import { WStorageIdentifiers } from "./identifiers";
import { exists, readFile } from "../utils/util";
import { getMatchStatus } from "../../apiv1/controllers.common";

export interface RepositoryV2ServiceOptions {
  repositoryPath?: string;
}

export class RepositoryV2Service implements WStorageService {
  IDENTIFIER = WStorageIdentifiers.RepositoryV2;
  repositoryPath: string;

  constructor(options: RepositoryV2ServiceOptions) {
    this.repositoryPath = options.repositoryPath!;
  }

  async init() {
    logger.info(`${this.IDENTIFIER} initialized`, {
      repositoryPath: this.repositoryPath,
    });
    return true;
  }

  async getFile(
    chainId: string,
    address: string,
    match: V1MatchLevelWithoutAny,
    path: string,
  ): Promise<string | false> {
    return await readFile(this.repositoryPath, match, chainId, address, path);
  }

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
   * Save file to repository and update the repository tag. The path may include non-existent parent directories.
   *
   * @param path the path within the repository where the file will be stored
   * @param content the content to be stored
   */
  async save(path: PathConfig, content: string) {
    const abolsutePath = this.generateAbsoluteFilePath(path);
    await fs.promises.mkdir(Path.dirname(abolsutePath), { recursive: true });
    await fs.promises.writeFile(abolsutePath, content);
    logger.silly(`Saved file to ${this.IDENTIFIER}`, { abolsutePath });
  }

  public async storeVerification(verification: VerificationExport) {
    if (
      verification.address &&
      (verification.status.runtimeMatch === "perfect" ||
        verification.status.runtimeMatch === "partial" ||
        verification.status.creationMatch === "perfect" ||
        verification.status.creationMatch === "partial")
    ) {
      // Delete the partial matches if we now have a perfect match instead.
      if (
        verification.status.runtimeMatch === "perfect" ||
        verification.status.creationMatch === "perfect"
      ) {
        await this.deletePartialIfExists(
          verification.chainId.toString(),
          verification.address,
        );
      }
      const matchQuality: MatchQuality = this.statusToMatchQuality(
        getMatchStatus(verification.status),
      );

      await this.storeSources(
        matchQuality,
        verification.chainId.toString(),
        verification.address,
        verification.compilation.sources,
      );

      // Store metadata
      await this.storeJSON(
        matchQuality,
        verification.chainId.toString(),
        verification.address,
        "metadata.json",
        verification.compilation.metadata,
      );

      if (verification.transformations.creation.values.constructorArguments) {
        await this.storeTxt(
          matchQuality,
          verification.chainId.toString(),
          verification.address,
          "constructor-args.txt",
          verification.transformations.creation.values.constructorArguments,
        );
      }

      if (verification.deploymentInfo.txHash) {
        await this.storeTxt(
          matchQuality,
          verification.chainId.toString(),
          verification.address,
          "creator-tx-hash.txt",
          verification.deploymentInfo.txHash,
        );
      }

      if (
        verification.libraryMap &&
        Object.keys(verification.libraryMap).length
      ) {
        await this.storeJSON(
          matchQuality,
          verification.chainId.toString(),
          verification.address,
          "library-map.json",
          verification.libraryMap,
        );
      }

      if (
        verification.compilation.immutableReferences &&
        Object.keys(verification.compilation.immutableReferences).length > 0
      ) {
        await this.storeJSON(
          matchQuality,
          verification.chainId.toString(),
          verification.address,
          "immutable-references.json",
          verification.compilation.immutableReferences,
        );
      }

      logger.info(`Stored contract to ${this.IDENTIFIER}`, {
        address: verification.address,
        chainId: verification.chainId.toString(),
        runtimeMatch: verification.status.runtimeMatch,
        creationMatch: verification.status.creationMatch,
        name: verification.compilation.compilationTarget.name,
      });
    } else {
      throw new Error(
        `Unknown match status: ${verification.status.runtimeMatch}`,
      );
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
  private statusToMatchQuality(status: VerificationStatus): MatchQuality {
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
    for (const sourcePath in sources) {
      await this.save(
        {
          matchQuality,
          chainId,
          address,
          source: true,
          // Store the file with the keccak as name
          fileName: `${keccak256(sources[sourcePath])}`,
        },
        sources[sourcePath],
      );
    }
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
}
