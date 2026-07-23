import type {
  SourcifyChain,
  ISolidityCompiler,
  SolidityJsonInput,
  VyperJsonInput,
  FeJsonInput,
  PathBuffer,
  SourcifyChainMap,
  VerificationExport,
  SourcifyChainInstance,
  CompilationTarget,
  Metadata,
  EtherscanResult,
  AnyCompilation,
} from "@ethereum-sourcify/lib-sourcify";
import { Verification } from "@ethereum-sourcify/lib-sourcify";
import { getCreatorTx } from "./utils/contract-creation-util";
import { ContractIsAlreadyBeingVerifiedError } from "../../common/errors/ContractIsAlreadyBeingVerifiedError";
import logger from "../../common/logger";
import {
  findSolcPlatform,
  getSolcExecutable,
  getSolcJs,
} from "@ethereum-sourcify/compilers";
import type { S3Config, VerificationJobId } from "../types";
import type { StorageService, WStorageService } from "./StorageService";
import { RWStorageIdentifiers } from "./storageServices/identifiers";
import Piscina from "piscina";
import path from "path";
import { filename as verificationWorkerFilename } from "./workers/verificationWorker";
import { v4 as uuidv4 } from "uuid";
import { ConflictError } from "../../common/errors/ConflictError";
import os from "os";
import type {
  VerifyErrorExport,
  VerifyFromEtherscanInput,
} from "./workers/workerTypes";
import {
  VerifyError,
  type VerifyFromJsonInput,
  type VerifyFromMetadataInput,
  type VerifyOutput,
  type VerifySimilarityInput,
} from "./workers/workerTypes";
import { asyncLocalStorage } from "../../common/async-context";
import { ContractNotDeployedError, GetBytecodeError } from "../apiv2/errors";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const DEFAULT_SIMILARITY_CANDIDATE_LIMIT = 20;

// How often the reaper checks for stale (never-completed) verification jobs.
const DEFAULT_REAPER_INTERVAL_MS = 300000; // 5 minutes
// A job whose started_at is older than this and is still in progress is
// considered abandoned (e.g. the worker OOMed or hung) and gets failed.
const DEFAULT_REAPER_STALE_JOB_THRESHOLD_MS = 10800000; // 3 hours

export interface VerificationServiceOptions {
  initCompilers?: boolean;
  sourcifyChainMap: SourcifyChainMap;
  solcRepoPath: string;
  solJsonRepoPath: string;
  vyperRepoPath: string;
  feRepoPath: string;
  workerIdleTimeout?: number;
  concurrentVerificationsPerWorker?: number;
  debugDataS3Config?: S3Config;
  reaperEnabled?: boolean;
  reaperIntervalMs?: number;
  reaperStaleJobThresholdMs?: number;
}

export class VerificationService {
  initCompilers: boolean;
  solcRepoPath: string;
  solJsonRepoPath: string;
  storageService: StorageService;
  private sourcifyChainMap: SourcifyChainMap;

  activeVerificationsByChainIdAddress: {
    [chainIdAndAddress: string]: boolean;
  } = {};

  private workerPool: Piscina;
  private runningTasks: Set<Promise<void>> = new Set();

  private readonly debugDataS3Client?: S3Client;
  private readonly debugDataS3Bucket?: string;

  private readonly reaperEnabled: boolean;
  private readonly reaperIntervalMs: number;
  private readonly reaperStaleJobThresholdMs: number;
  private reaperInterval?: NodeJS.Timeout;
  private isReaping = false;

  constructor(
    options: VerificationServiceOptions,
    storageService: StorageService,
  ) {
    this.initCompilers = options.initCompilers || false;
    this.solcRepoPath = options.solcRepoPath;
    this.solJsonRepoPath = options.solJsonRepoPath;
    this.storageService = storageService;
    this.sourcifyChainMap = options.sourcifyChainMap;

    this.reaperEnabled = options.reaperEnabled ?? true;
    this.reaperIntervalMs =
      options.reaperIntervalMs ?? DEFAULT_REAPER_INTERVAL_MS;
    this.reaperStaleJobThresholdMs =
      options.reaperStaleJobThresholdMs ??
      DEFAULT_REAPER_STALE_JOB_THRESHOLD_MS;

    if (options.debugDataS3Config) {
      const s3Config = options.debugDataS3Config;
      this.debugDataS3Bucket = s3Config.bucket;
      this.debugDataS3Client = new S3Client({
        region: s3Config.region,
        credentials:
          s3Config.accessKeyId && s3Config.secretAccessKey
            ? {
                accessKeyId: s3Config.accessKeyId,
                secretAccessKey: s3Config.secretAccessKey,
              }
            : undefined,
        endpoint: s3Config.endpoint,
      });
    }

    const sourcifyChainInstanceMap = Object.entries(
      options.sourcifyChainMap,
    ).reduce(
      (acc, [chainId, chain]) => {
        acc[chainId] = chain.getSourcifyChainObj();
        return acc;
      },
      {} as Record<string, SourcifyChainInstance>,
    );

    let availableParallelism = os.availableParallelism();
    if (process.env.CI === "true") {
      // when calling os.availableParallelism(), CircleCI returns the number of CPUs
      // the hardware has actually, not the number of available vCPUs.
      // Therefore, we set it to the number of vCPUs which our resource class uses.
      availableParallelism = 4;
    }
    // Default values of Piscina
    const minThreads = availableParallelism * 0.5;
    const maxThreads = availableParallelism * 1.5;

    this.workerPool = new Piscina({
      filename: path.resolve(__dirname, "./workers/workerWrapper.js"),
      workerData: {
        fullpath: verificationWorkerFilename,
        // We can use the environment variable because it is overwritten by setLogLevel at server startup
        logLevel: process.env.NODE_LOG_LEVEL,
        sourcifyChainInstanceMap,
        solcRepoPath: options.solcRepoPath,
        solJsonRepoPath: options.solJsonRepoPath,
        vyperRepoPath: options.vyperRepoPath,
        feRepoPath: options.feRepoPath,
      },
      minThreads,
      maxThreads,
      idleTimeout: options.workerIdleTimeout || 30000,
      concurrentTasksPerWorker: options.concurrentVerificationsPerWorker || 5,
    });
  }

  // All of the solidity compilation actually run outside the VerificationService but this is an OK place to init everything.
  public async init() {
    const HOST_SOLC_REPO = "https://binaries.soliditylang.org/";

    if (this.initCompilers) {
      const platform = findSolcPlatform() || "bin"; // fallback to emscripten binaries "bin"
      logger.info(`Initializing compilers for platform ${platform}`);

      // solc binary and solc-js downloads are handled with different helpers
      const downLoadFunc =
        platform === "bin"
          ? (version: string) => getSolcJs(this.solJsonRepoPath, version)
          : (version: string) =>
              getSolcExecutable(this.solcRepoPath, platform, version);

      // get the list of compiler versions
      let solcList: string[];
      try {
        solcList = await fetch(`${HOST_SOLC_REPO}${platform}/list.json`)
          .then((response) => response.json())
          .then((data) =>
            (Object.values(data.releases) as string[])
              .map((str) => str.split("-v")[1]) // e.g. soljson-v0.8.26+commit.8a97fa7a.js or solc-linux-amd64-v0.8.26+commit.8a97fa7a
              .map(
                (str) => (str.endsWith(".js") ? str.slice(0, -3) : str), // remove .js extension
              ),
          );
      } catch (e) {
        throw new Error(`Failed to fetch list of solc versions: ${e}`);
      }

      const chunkSize = 10; // Download in chunks to not overload the Solidity server all at once
      for (let i = 0; i < solcList.length; i += chunkSize) {
        const chunk = solcList.slice(i, i + chunkSize);
        const promises = chunk.map((solcVer) => {
          const now = Date.now();
          return downLoadFunc(solcVer).then(() => {
            logger.debug(
              `Downloaded (or found existing) compiler ${solcVer} in ${Date.now() - now}ms`,
            );
          });
        });

        await Promise.all(promises);
        logger.debug(
          `Batch ${i / chunkSize + 1} - Downloaded ${promises.length} - Total ${i + chunkSize}/${solcList.length}`,
        );
      }

      logger.info("Initialized compilers");
    }

    this.startStaleJobReaper();

    return true;
  }

  public async close() {
    logger.info("Gracefully closing all in-process verifications");
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = undefined;
    }
    // Immediately abort all workers. Tasks that still run will have their Promises rejected.
    await this.workerPool.destroy();
    // Here, we wait for the rejected tasks which also waits for writing the failed status to the database.
    await Promise.all(this.runningTasks);
  }

  // Periodically fails verification jobs that never completed (e.g. the worker
  // OOMed or hung) so their chain+address stops being locked against
  // resubmission. See: https://github.com/argotorg/sourcify/issues/2880
  private startStaleJobReaper() {
    if (!this.reaperEnabled) {
      logger.info("Stale verification-job reaper disabled, not starting");
      return;
    }

    const sourcifyDatabase =
      this.storageService.rwServices[RWStorageIdentifiers.SourcifyDatabase];
    if (!sourcifyDatabase?.reapStaleJobs) {
      logger.info(
        "SourcifyDatabase storage service not configured, not starting stale verification-job reaper",
      );
      return;
    }

    logger.info("Starting stale verification-job reaper", {
      intervalMs: this.reaperIntervalMs,
      staleJobThresholdMs: this.reaperStaleJobThresholdMs,
    });

    this.reaperInterval = setInterval(() => {
      void this.reapStaleJobs();
    }, this.reaperIntervalMs);
    // Don't let the reaper timer keep the process alive (e.g. in tests).
    this.reaperInterval.unref();
  }

  private async reapStaleJobs(): Promise<void> {
    // Guard against overlapping runs if a reap takes longer than the interval.
    if (this.isReaping) {
      logger.debug("Stale verification-job reaper already running, skipping");
      return;
    }
    this.isReaping = true;
    try {
      const sourcifyDatabase =
        this.storageService.rwServices[RWStorageIdentifiers.SourcifyDatabase];
      if (!sourcifyDatabase?.reapStaleJobs) {
        return;
      }
      const reapedIds = await sourcifyDatabase.reapStaleJobs(
        this.reaperStaleJobThresholdMs,
      );
      if (reapedIds.length > 0) {
        logger.info("Reaped stale verification jobs", {
          count: reapedIds.length,
          verificationIds: reapedIds,
          staleJobThresholdMs: this.reaperStaleJobThresholdMs,
        });
      }
    } catch (error) {
      // Never throw out of the interval callback.
      logger.error("Failed to reap stale verification jobs", { error });
    } finally {
      this.isReaping = false;
    }
  }

  private throwErrorIfContractIsAlreadyBeingVerified(
    chainId: string,
    address: string,
  ) {
    if (
      this.activeVerificationsByChainIdAddress[`${chainId}:${address}`] !==
      undefined
    ) {
      logger.warn("Contract already being verified", { chainId, address });
      throw new ContractIsAlreadyBeingVerifiedError(chainId, address);
    }
  }

  public async verifyFromCompilation(
    compilation: AnyCompilation,
    sourcifyChain: SourcifyChain,
    address: string,
    creatorTxHash?: string,
  ): Promise<Verification> {
    const chainId = sourcifyChain.chainId.toString();
    logger.debug("VerificationService.verifyFromCompilation", {
      chainId,
      address,
    });
    this.throwErrorIfContractIsAlreadyBeingVerified(chainId, address);
    this.activeVerificationsByChainIdAddress[`${chainId}:${address}`] = true;

    const foundCreatorTxHash =
      creatorTxHash ||
      (await getCreatorTx(sourcifyChain, address)) ||
      undefined;

    const verification = new Verification(
      compilation,
      sourcifyChain,
      address,
      foundCreatorTxHash,
    );

    try {
      await verification.verify();
      return verification;
    } finally {
      delete this.activeVerificationsByChainIdAddress[`${chainId}:${address}`];
    }
  }

  public async verifyFromJsonInputViaWorker(
    verificationEndpoint: string,
    chainId: string,
    address: string,
    jsonInput: SolidityJsonInput | VyperJsonInput | FeJsonInput,
    compilerVersion: string,
    compilationTarget: CompilationTarget,
    creationTransactionHash?: string,
  ): Promise<VerificationJobId> {
    const verificationId = await this.storageService.performServiceOperation(
      "storeVerificationJob",
      [new Date(), chainId, address, verificationEndpoint],
    );

    const input: VerifyFromJsonInput = {
      chainId,
      address,
      jsonInput,
      compilerVersion,
      compilationTarget,
      creationTransactionHash,
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    this.runInBackground(
      this.verifyViaWorker(verificationId, "verifyFromJsonInput", input),
    );

    return verificationId;
  }

  public async verifyFromMetadataViaWorker(
    verificationEndpoint: string,
    chainId: string,
    address: string,
    metadata: Metadata,
    sources: Record<string, string>,
    creationTransactionHash?: string,
  ): Promise<VerificationJobId> {
    const verificationId = await this.storageService.performServiceOperation(
      "storeVerificationJob",
      [new Date(), chainId, address, verificationEndpoint],
    );

    const input: VerifyFromMetadataInput = {
      chainId,
      address,
      metadata,
      sources,
      creationTransactionHash,
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    this.runInBackground(
      this.verifyViaWorker(verificationId, "verifyFromMetadata", input),
    );
    return verificationId;
  }

  public async verifyFromEtherscanViaWorker(
    verificationEndpoint: string,
    chainId: string,
    address: string,
    etherscanResult: EtherscanResult,
  ): Promise<VerificationJobId> {
    const verificationId = await this.storageService.performServiceOperation(
      "storeVerificationJob",
      [new Date(), chainId, address, verificationEndpoint],
    );

    const input: VerifyFromEtherscanInput = {
      chainId,
      address,
      etherscanResult,
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    this.runInBackground(
      this.verifyViaWorker(verificationId, "verifyFromEtherscan", input),
    );

    return verificationId;
  }

  public async verifyFromSimilarityViaWorker(
    verificationEndpoint: string,
    chainId: string,
    address: string,
    creationTransactionHash?: string,
  ): Promise<VerificationJobId> {
    let runtimeBytecode: string;
    try {
      runtimeBytecode =
        await this.sourcifyChainMap[chainId].getBytecode(address);
    } catch (error) {
      throw new GetBytecodeError(
        `Failed to get bytecode for chain ${chainId} and address ${address}.`,
      );
    }

    if (
      !runtimeBytecode ||
      runtimeBytecode === "0x" ||
      runtimeBytecode === ""
    ) {
      throw new ContractNotDeployedError(
        `There is no bytecode at address ${address} on chain ${chainId}.`,
      );
    }

    const verificationId = await this.storageService.performServiceOperation(
      "storeVerificationJob",
      [new Date(), chainId, address, verificationEndpoint],
    );

    this.runInBackground(
      (async () => {
        try {
          const candidates = await this.storageService.performServiceOperation(
            "getSimilarityCandidatesByRuntimeCode",
            [runtimeBytecode, DEFAULT_SIMILARITY_CANDIDATE_LIMIT],
          );

          if (candidates.length === 0) {
            logger.info("No similarity candidates found", {
              chainId,
              address,
            });
            await this.storeJobError([
              verificationId,
              new Date(),
              {
                customCode: "no_similar_match_found",
                errorId: uuidv4(),
                errorData: undefined,
              },
            ]);
            return;
          }

          const input: VerifySimilarityInput = {
            chainId,
            address,
            runtimeBytecode,
            creationTransactionHash,
            candidates,
            traceId: asyncLocalStorage.getStore()?.traceId,
          };

          await this.verifyViaWorker(verificationId, "verifySimilarity", input);
        } catch (error) {
          logger.error("Failed to fetch similarity candidates", {
            chainId,
            address,
            error,
          });
          await this.storeJobError([
            verificationId,
            new Date(),
            {
              customCode: "internal_error",
              errorId: uuidv4(),
            },
          ]);
        }
      })(),
    );

    return verificationId;
  }

  private verifyViaWorker(
    verificationId: VerificationJobId,
    functionName: string,
    input:
      | VerifyFromJsonInput
      | VerifyFromMetadataInput
      | VerifyFromEtherscanInput
      | VerifySimilarityInput,
  ): Promise<void> {
    return this.workerPool
      .run(input, { name: functionName })
      .then((output: VerifyOutput) => {
        if (output.verificationExport) {
          return output.verificationExport;
        } else if (output.errorExport) {
          throw new VerifyError(output.errorExport);
        }
        const errorMessage = `The worker did not return a verification export nor an error export. This should never happen.`;
        logger.error(errorMessage, { output });
        throw new Error(errorMessage);
      })
      .then((verification: VerificationExport) => {
        return this.storageService.storeVerification(verification, {
          verificationId,
          finishTime: new Date(),
        });
      })
      .catch((error) => {
        let errorExport: VerifyErrorExport;
        if (error instanceof VerifyError) {
          // error comes from the verification worker
          logger.debug("Received verification error from worker", {
            verificationId,
            errorExport: {
              ...error.errorExport,
              // Don't log the full bytecodes because it's too long
              onchainRuntimeCode: error.errorExport?.onchainRuntimeCode
                ? error.errorExport.onchainRuntimeCode.slice(0, 200) + "..."
                : error.errorExport?.onchainRuntimeCode,
              recompiledRuntimeCode: error.errorExport?.recompiledRuntimeCode
                ? error.errorExport.recompiledRuntimeCode.slice(0, 200) + "..."
                : error.errorExport?.recompiledRuntimeCode,
              onchainCreationCode: error.errorExport?.onchainCreationCode
                ? error.errorExport.onchainCreationCode.slice(0, 200) + "..."
                : error.errorExport?.onchainCreationCode,
              recompiledCreationCode: error.errorExport?.recompiledCreationCode
                ? error.errorExport.recompiledCreationCode.slice(0, 200) + "..."
                : error.errorExport?.recompiledCreationCode,
            },
          });
          errorExport = error.errorExport;
        } else if (error instanceof ConflictError) {
          // returned by StorageService if match already exists and new one is not better
          errorExport = {
            customCode: "already_verified",
            errorId: uuidv4(),
          };
        } else {
          errorExport = {
            customCode: "internal_error",
            errorId: uuidv4(),
          };
          logger.error("Unexpected verification error", {
            verificationId,
            error,
            errorId: errorExport.errorId,
          });
        }

        return this.storeJobError(
          [verificationId, new Date(), errorExport],
          input,
        );
      });
  }

  private async storeInputDataToS3(
    verificationId: VerificationJobId,
    verificationInput:
      | VerifyFromJsonInput
      | VerifyFromMetadataInput
      | VerifyFromEtherscanInput
      | VerifySimilarityInput,
  ): Promise<void> {
    if (!this.debugDataS3Client || !this.debugDataS3Bucket) {
      logger.debug(
        "S3 client not configured, skipping verification input storage",
      );
      return;
    }

    try {
      const key = `failed-verification-inputs/${verificationId}.json`;
      const body = JSON.stringify(verificationInput, null, 2);

      const command = new PutObjectCommand({
        Bucket: this.debugDataS3Bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
      });

      await this.debugDataS3Client.send(command);
      logger.debug("Stored verification input to S3", {
        verificationId,
        key,
      });
    } catch (error) {
      logger.error("Failed to store verification input to S3", {
        verificationId,
        error,
      });
    }
  }

  private async storeJobError(
    storageArgs: Parameters<Required<WStorageService>["setJobError"]>,
    verificationInput?:
      | VerifyFromJsonInput
      | VerifyFromMetadataInput
      | VerifyFromEtherscanInput
      | VerifySimilarityInput,
  ): Promise<void> {
    const promises = [];
    promises.push(
      this.storageService.performServiceOperation("setJobError", storageArgs),
    );
    if (
      verificationInput &&
      ("jsonInput" in verificationInput || "metadata" in verificationInput)
    ) {
      const verificationId = storageArgs[0];
      promises.push(this.storeInputDataToS3(verificationId, verificationInput));
    }
    await Promise.all(promises);
  }

  private runInBackground(promise: Promise<void>): void {
    const task = promise.finally(() => {
      this.runningTasks.delete(task);
    });
    this.runningTasks.add(task);
  }
}
