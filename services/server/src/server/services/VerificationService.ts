import type {
  SourcifyChain,
  ISolidityCompiler,
  SolidityJsonInput,
  VyperJsonInput,
  FeJsonInput,
  PathBuffer,
  SourcifyChainMap,
  SourcifyChainInstance,
  CompilationTarget,
  Metadata,
  EtherscanResult,
  AnyCompilation,
} from "@ethereum-sourcify/lib-sourcify";
import {
  SolidityMetadataContract,
  Verification,
} from "@ethereum-sourcify/lib-sourcify";
import { getCreatorTx } from "./utils/contract-creation-util";
import { ContractIsAlreadyBeingVerifiedError } from "../../common/errors/ContractIsAlreadyBeingVerifiedError";
import logger from "../../common/logger";
import {
  findSolcPlatform,
  getSolcExecutable,
  getSolcJs,
} from "@ethereum-sourcify/compilers";
import type {
  S3Config,
  SimilarityCandidate,
  VerificationJobId,
} from "../types";
import type { StorageService, WStorageService } from "./StorageService";
import Piscina from "piscina";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { EventLoopUtilization } from "node:perf_hooks";
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
  type SimilarityCreationData,
  type WorkerTaskStartMessage,
} from "./workers/workerTypes";
import { asyncLocalStorage } from "../../common/async-context";
import {
  BytecodeTooShortForSimilarityError,
  ContractNotDeployedError,
  GetBytecodeError,
} from "../apiv2/errors";
import type { VerificationErrorCode } from "../apiv2/errors";
import {
  isStatementTimeoutError,
  SIMILARITY_PREFIX_LENGTH_BYTES,
} from "./utils/database-util";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const DEFAULT_SIMILARITY_CANDIDATE_LIMIT = 20;
// Must be larger than the compiler timeout, so that a slow compile fails
// with compiler_timeout and not with job_timeout.
const DEFAULT_WORKER_TASK_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_RUNTIME_STATS_INTERVAL_MS = 60 * 1000;
const SIMILARITY_CANDIDATE_BATCH_SIZE = 5;

/**
 * Service-side input for similarity verification: additionally carries the
 * candidate compilation ids so the worker can be run batch by batch. The
 * worker only ever sees the `candidates` of the current batch.
 */
type VerifySimilarityServiceInput = VerifySimilarityInput & {
  candidateIds: string[];
};

export interface VerificationServiceOptions {
  initCompilers?: boolean;
  sourcifyChainMap: SourcifyChainMap;
  solcRepoPath: string;
  solJsonRepoPath: string;
  vyperRepoPath: string;
  feRepoPath: string;
  compilerTimeoutMs?: number;
  // Wall-clock limit for one running worker task. 0 disables it.
  workerTaskTimeoutMs?: number;
  // Interval of the "Worker runtime stats" log line. 0 disables it.
  runtimeStatsIntervalMs?: number;
  workerIdleTimeout?: number;
  concurrentVerificationsPerWorker?: number;
  debugDataS3Config?: S3Config;
}

/**
 * A verification job that was handed to the worker pool and did not finish
 * yet. `threadId` and `timeoutTimer` are set once the worker thread announced
 * the job with a `task-start` message.
 */
interface RunningTask {
  verificationId: VerificationJobId;
  functionName: string;
  chainId: string;
  address: string;
  startedAt: Date;
  threadId?: number;
  timeoutTimer?: NodeJS.Timeout;
  timedOut?: boolean;
  promise: Promise<void>;
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
  private workerTaskTimeoutMs?: number;
  private runningTasks: Map<VerificationJobId, RunningTask> = new Map();
  private runtimeStatsTimer?: NodeJS.Timeout;
  private prevWorkerElu: Map<number, EventLoopUtilization> = new Map();
  private prevMainElu = performance.eventLoopUtilization();
  private mainLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  private prevCpuUsage = process.cpuUsage();
  private prevStatsAt = Date.now();

  private readonly debugDataS3Client?: S3Client;
  private readonly debugDataS3Bucket?: string;

  constructor(
    options: VerificationServiceOptions,
    storageService: StorageService,
  ) {
    this.initCompilers = options.initCompilers || false;
    this.solcRepoPath = options.solcRepoPath;
    this.solJsonRepoPath = options.solJsonRepoPath;
    this.storageService = storageService;
    this.sourcifyChainMap = options.sourcifyChainMap;
    this.workerTaskTimeoutMs =
      (options.workerTaskTimeoutMs ?? DEFAULT_WORKER_TASK_TIMEOUT_MS) ||
      undefined;
    if (
      this.workerTaskTimeoutMs &&
      options.compilerTimeoutMs &&
      this.workerTaskTimeoutMs <= options.compilerTimeoutMs
    ) {
      logger.warn(
        "The worker task timeout is not larger than the compiler timeout, slow compilations will fail with job_timeout instead of compiler_timeout",
        {
          workerTaskTimeoutMs: this.workerTaskTimeoutMs,
          compilerTimeoutMs: options.compilerTimeoutMs,
        },
      );
    }

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
        // Workers run in separate threads and do not share this global
        ipfsGateway: SolidityMetadataContract.getGlobalIpfsGateway(),
        solcRepoPath: options.solcRepoPath,
        solJsonRepoPath: options.solJsonRepoPath,
        vyperRepoPath: options.vyperRepoPath,
        feRepoPath: options.feRepoPath,
        compilerTimeoutMs: options.compilerTimeoutMs,
      },
      minThreads,
      maxThreads,
      idleTimeout: options.workerIdleTimeout || 30000,
      concurrentTasksPerWorker: options.concurrentVerificationsPerWorker || 5,
    });
    this.workerPool.on("message", (message: unknown) =>
      this.onWorkerMessage(message),
    );

    const runtimeStatsIntervalMs =
      options.runtimeStatsIntervalMs ?? DEFAULT_RUNTIME_STATS_INTERVAL_MS;
    if (runtimeStatsIntervalMs > 0) {
      this.mainLoopDelay.enable();
      this.runtimeStatsTimer = setInterval(
        () => this.logRuntimeStats(),
        runtimeStatsIntervalMs,
      );
      // Must not keep the process alive
      this.runtimeStatsTimer.unref();
    }
  }

  private onWorkerMessage(message: unknown) {
    const taskStart = message as WorkerTaskStartMessage | null;
    if (taskStart?.type !== "task-start") {
      return;
    }
    // The job is registered in the same tick as its dispatch, so it exists here
    const task = this.runningTasks.get(taskStart.verificationId);
    if (!task) {
      return;
    }
    task.threadId = taskStart.threadId;
    // Similarity verification runs one worker task per candidate batch
    clearTimeout(task.timeoutTimer);
    if (this.workerTaskTimeoutMs) {
      task.timeoutTimer = setTimeout(
        () => this.terminateTimedOutTask(task),
        this.workerTaskTimeoutMs,
      );
      task.timeoutTimer.unref();
    }
  }

  /**
   * Terminates the worker thread of a task that runs for too long. Piscina
   * replaces the thread and rejects the tasks that ran on it. The job of the
   * timed out task is then failed with job_timeout by storeVerificationOutcome,
   * which also stores its input for debugging. Other tasks on the same thread
   * fail with internal_error, as for any other worker crash.
   */
  private terminateTimedOutTask(task: RunningTask) {
    const worker = this.workerPool.threads.find(
      (thread) => thread.threadId === task.threadId,
    );
    logger.error("Verification worker task timed out", {
      verificationId: task.verificationId,
      functionName: task.functionName,
      chainId: task.chainId,
      address: task.address,
      runningForMs: Date.now() - task.startedAt.getTime(),
      timeoutMs: this.workerTaskTimeoutMs,
      threadId: task.threadId,
    });
    task.timedOut = true;
    worker?.terminate().catch((error) => {
      logger.warn("Failed to terminate timed out worker thread", {
        verificationId: task.verificationId,
        threadId: task.threadId,
        error,
      });
    });
  }

  /**
   * Logs the event loop utilization (ELU) of the main thread and of every
   * worker thread that runs a task, together with the jobs on it, and the
   * CPU of the whole process. A worker at ELU 1.0 over several intervals
   * next to one job id points at the input of that job. `cpu.outsideLoops`
   * near one core means the CPU is in none of the event loops: V8 or libuv
   * threads, or outside of the Node process. Compiler child processes are
   * not part of `cpu.cores`.
   *
   * Threads without a task are not listed: they block in Atomics.wait()
   * while waiting for a task, which their ELU reports as busy.
   */
  private logRuntimeStats() {
    try {
      const now = Date.now();
      const intervalMs = now - this.prevStatsAt;
      this.prevStatsAt = now;

      const tasksByThread = new Map<number, RunningTask[]>();
      for (const task of this.runningTasks.values()) {
        if (task.threadId !== undefined) {
          const tasks = tasksByThread.get(task.threadId) ?? [];
          tasks.push(task);
          tasksByThread.set(task.threadId, tasks);
        }
      }

      const workers = [];
      let threadsWithoutTask = 0;
      let taskElu = 0;
      const seenThreadIds = new Set<number>();
      for (const worker of this.workerPool.threads) {
        const { threadId } = worker;
        seenThreadIds.add(threadId);
        const elu = worker.performance.eventLoopUtilization();
        const prevElu = this.prevWorkerElu.get(threadId);
        this.prevWorkerElu.set(threadId, elu);
        const tasks = tasksByThread.get(threadId);
        if (!tasks) {
          threadsWithoutTask++;
          continue;
        }
        // Null on the first interval of a thread
        const eluDelta = prevElu
          ? worker.performance.eventLoopUtilization(elu, prevElu).utilization
          : null;
        taskElu += eluDelta ?? 0;
        workers.push({
          threadId,
          elu: eluDelta === null ? null : Math.round(eluDelta * 1000) / 1000,
          tasks: tasks.map((task) => ({
            verificationId: task.verificationId,
            functionName: task.functionName,
            chainId: task.chainId,
            address: task.address,
            runningForMs: now - task.startedAt.getTime(),
          })),
        });
      }
      for (const threadId of this.prevWorkerElu.keys()) {
        if (!seenThreadIds.has(threadId)) {
          this.prevWorkerElu.delete(threadId);
        }
      }

      const mainElu = performance.eventLoopUtilization(
        this.prevMainElu,
      ).utilization;
      this.prevMainElu = performance.eventLoopUtilization();
      // The delay histogram is in nanoseconds
      const mainLoopDelayP99Ms = this.mainLoopDelay.percentile(99) / 1e6;
      this.mainLoopDelay.reset();

      const cpuUsage = process.cpuUsage(this.prevCpuUsage);
      this.prevCpuUsage = process.cpuUsage();
      // cpuUsage is in microseconds
      const cores = (cpuUsage.user + cpuUsage.system) / (intervalMs * 1000);

      logger.info("Worker runtime stats", {
        intervalMs,
        main: {
          elu: Math.round(mainElu * 1000) / 1000,
          // High ELU with a low delay means many short callbacks, a high
          // delay means blocking work
          loopDelayP99Ms: Math.round(mainLoopDelayP99Ms * 1000) / 1000,
        },
        workers,
        pool: {
          threads: this.workerPool.threads.length,
          threadsWithoutTask,
          queueSize: this.workerPool.queueSize,
          completed: this.workerPool.completed,
        },
        cpu: {
          userMs: Math.round(cpuUsage.user / 1000),
          systemMs: Math.round(cpuUsage.system / 1000),
          // Average number of cores the process used since the last line
          cores: Math.round(cores * 1000) / 1000,
          // Sum of the ELU of the listed worker threads
          taskElu: Math.round(taskElu * 1000) / 1000,
          // CPU in none of the event loops: V8 or libuv threads, or a
          // nested thread outside of a task. A thread blocked in a
          // synchronous call (e.g. spawnSync) counts as busy in its ELU
          // although it burns no CPU, so taskElu can be higher than the
          // real CPU of the workers and outsideLoops can undershoot.
          outsideLoops:
            Math.round(Math.max(0, cores - mainElu - taskElu) * 1000) / 1000,
        },
        rss: process.memoryUsage().rss,
      });
    } catch (error) {
      logger.warn("Failed to log worker runtime stats", { error });
    }
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
    return true;
  }

  public async close() {
    logger.info("Gracefully closing all in-process verifications");
    clearInterval(this.runtimeStatsTimer);
    this.mainLoopDelay.disable();
    // Immediately abort all workers. Tasks that still run will have their Promises rejected.
    await this.workerPool.destroy();
    // Here, we wait for the rejected tasks which also waits for writing the failed status to the database.
    await Promise.all(
      [...this.runningTasks.values()].map((task) => task.promise),
    );
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
      verificationId,
      chainId,
      address,
      jsonInput,
      compilerVersion,
      compilationTarget,
      creationTransactionHash,
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    this.runInBackground(
      { verificationId, functionName: "verifyFromJsonInput", chainId, address },
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
      verificationId,
      chainId,
      address,
      metadata,
      sources,
      creationTransactionHash,
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    this.runInBackground(
      { verificationId, functionName: "verifyFromMetadata", chainId, address },
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
      verificationId,
      chainId,
      address,
      etherscanResult,
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    this.runInBackground(
      { verificationId, functionName: "verifyFromEtherscan", chainId, address },
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

    // Similarity candidates are indexed by their first 75 bytes of runtime
    // code. The index only holds prefixes of exactly 75 bytes, so shorter
    // bytecodes (e.g. EIP-1167 minimal proxies) are deliberately not
    // supported and are rejected upfront.
    const runtimeBytecodeLengthBytes = (runtimeBytecode.length - 2) / 2;
    if (runtimeBytecodeLengthBytes < SIMILARITY_PREFIX_LENGTH_BYTES) {
      throw new BytecodeTooShortForSimilarityError(
        `The bytecode at address ${address} on chain ${chainId} is only ${runtimeBytecodeLengthBytes} bytes long. Similarity verification requires at least ${SIMILARITY_PREFIX_LENGTH_BYTES} bytes.`,
      );
    }

    const verificationId = await this.storageService.performServiceOperation(
      "storeVerificationJob",
      [new Date(), chainId, address, verificationEndpoint],
    );

    this.runInBackground(
      { verificationId, functionName: "verifySimilarity", chainId, address },
      this.processSimilarityVerification(
        verificationId,
        chainId,
        address,
        runtimeBytecode,
        creationTransactionHash,
      ),
    );

    return verificationId;
  }

  /**
   * Background part of similarity verification: finds candidate compilation
   * ids for the contract's runtime bytecode and runs the worker over them
   * batch by batch. All failures are recorded on the verification job.
   */
  private async processSimilarityVerification(
    verificationId: VerificationJobId,
    chainId: string,
    address: string,
    runtimeBytecode: string,
    creationTransactionHash?: string,
  ): Promise<void> {
    let candidateIds: string[] = [];
    let errorCode: VerificationErrorCode | undefined;
    try {
      candidateIds = await this.storageService.performServiceOperation(
        "getSimilarityCandidateIdsByRuntimeCode",
        [runtimeBytecode, DEFAULT_SIMILARITY_CANDIDATE_LIMIT],
      );
      if (candidateIds.length === 0) {
        logger.info("No similarity candidates found", {
          chainId,
          address,
        });
        errorCode = "no_similar_match_found";
      }
    } catch (error) {
      logger.error("Failed to fetch similarity candidates", {
        chainId,
        address,
        error,
      });
      // The prefix scan is the query that can exceed the database's
      // statement_timeout, so surface that as its own error instead of an
      // opaque internal error.
      errorCode = isStatementTimeoutError(error)
        ? "similarity_search_timeout"
        : "internal_error";
    }

    if (errorCode) {
      await this.storeJobError([
        verificationId,
        new Date(),
        {
          customCode: errorCode,
          errorId: uuidv4(),
        },
      ]);
      return;
    }

    const creationData = await this.resolveSimilarityCreationData(
      chainId,
      address,
      creationTransactionHash,
    );

    const input: VerifySimilarityServiceInput = {
      verificationId,
      chainId,
      address,
      runtimeBytecode,
      creationData,
      candidateIds,
      // Filled batch by batch in runSimilarityWorkerBatches
      candidates: [],
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    await this.storeVerificationOutcome(
      verificationId,
      input,
      this.runSimilarityWorkerBatches(input),
    );
  }

  /**
   * Resolves the creation transaction data for the contract being verified.
   *
   * This used to happen inside the verification worker, but similarity
   * verification now calls the worker once per candidate batch, and repeating
   * these RPC calls per batch would be wasteful. Failures are non-fatal: without
   * creation data only a runtime match is possible.
   */
  private async resolveSimilarityCreationData(
    chainId: string,
    address: string,
    creationTransactionHash?: string,
  ): Promise<SimilarityCreationData> {
    const sourcifyChain = this.sourcifyChainMap[chainId];
    let resolvedCreatorTxHash = creationTransactionHash;

    try {
      resolvedCreatorTxHash =
        creationTransactionHash ||
        (await getCreatorTx(sourcifyChain, address)) ||
        undefined;

      if (!resolvedCreatorTxHash) {
        return {};
      }

      const creatorTx = await sourcifyChain.getTx(resolvedCreatorTxHash);
      const { creationBytecode, txReceipt } =
        await sourcifyChain.getContractCreationBytecodeAndReceipt(
          address,
          resolvedCreatorTxHash,
          creatorTx,
        );
      return {
        creationTransactionHash: resolvedCreatorTxHash,
        creationBytecode,
        deployer: creatorTx.from,
        blockNumber: creatorTx.blockNumber ?? undefined,
        txIndex: txReceipt.index ?? undefined,
      };
    } catch (error: any) {
      logger.debug(
        "Failed to fetch creation data for similarity verification",
        {
          chainId,
          address,
          creatorTxHash: resolvedCreatorTxHash,
          error: error?.message,
        },
      );
      return { creationTransactionHash: resolvedCreatorTxHash };
    }
  }

  /**
   * Runs similarity verification batch by batch: fetches the payloads for the
   * next slice of candidate compilation ids and hands them to the worker,
   * stopping at the first batch that yields a match or a real error.
   *
   * Candidate payloads carry the full standard JSON input and output, so
   * fetching all of them up front would pull ~20 large payloads out of the
   * database to use one of them.
   */
  private async runSimilarityWorkerBatches(
    input: VerifySimilarityServiceInput,
  ): Promise<VerifyOutput> {
    const { candidateIds, ...workerInput } = input;

    for (
      let offset = 0;
      offset < candidateIds.length;
      offset += SIMILARITY_CANDIDATE_BATCH_SIZE
    ) {
      const batchIds = candidateIds.slice(
        offset,
        offset + SIMILARITY_CANDIDATE_BATCH_SIZE,
      );

      let candidates: SimilarityCandidate[];
      try {
        candidates = await this.storageService.performServiceOperation(
          "getSimilarityCandidatesByCompilationIds",
          [batchIds],
        );
      } catch (error) {
        if (isStatementTimeoutError(error)) {
          return {
            errorExport: {
              customCode: "similarity_search_timeout",
              errorId: uuidv4(),
            },
          };
        }
        // Will be mapped to an internal_error by storeVerificationOutcome
        throw error;
      }

      if (candidates.length === 0) {
        continue;
      }

      const output = await this.workerPool.run(
        { ...workerInput, candidates },
        { name: "verifySimilarity" },
      );

      // Anything other than "this batch had no match" is terminal: either we
      // verified, or we hit a real error.
      if (
        output.verificationExport ||
        output.errorExport?.customCode !== "no_similar_match_found"
      ) {
        return output;
      }
    }

    return {
      errorExport: {
        customCode: "no_similar_match_found",
        errorId: uuidv4(),
        errorData: undefined,
      },
    };
  }

  private async verifyViaWorker(
    verificationId: VerificationJobId,
    functionName: string,
    input:
      | VerifyFromJsonInput
      | VerifyFromMetadataInput
      | VerifyFromEtherscanInput
      | VerifySimilarityInput,
  ): Promise<void> {
    return this.storeVerificationOutcome(
      verificationId,
      input,
      this.workerPool.run(input, { name: functionName }),
    );
  }

  /**
   * Persists the outcome of a verification attempt exactly once: stores the
   * verification on success, or records the job error on failure.
   *
   * Takes the pending worker output rather than running the worker itself so
   * that similarity verification, which produces its final output over several
   * batched worker runs, shares the same outcome handling. Rejections of the
   * pending output are classified here as well.
   */
  private async storeVerificationOutcome(
    verificationId: VerificationJobId,
    input:
      | VerifyFromJsonInput
      | VerifyFromMetadataInput
      | VerifyFromEtherscanInput
      | VerifySimilarityInput,
    pendingOutput: Promise<VerifyOutput>,
  ): Promise<void> {
    try {
      const output = await pendingOutput;

      if (output.verificationExport) {
        await this.storageService.storeVerification(output.verificationExport, {
          verificationId,
          finishTime: new Date(),
        });
        return;
      } else if (output.errorExport) {
        throw new VerifyError(output.errorExport);
      }

      const errorMessage = `The worker did not return a verification export nor an error export. This should never happen.`;
      logger.error(errorMessage, { output });
      throw new Error(errorMessage);
    } catch (error) {
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
      } else if (this.runningTasks.get(verificationId)?.timedOut) {
        // The worker thread was terminated by terminateTimedOutTask
        errorExport = {
          customCode: "job_timeout",
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

      await this.storeJobError(
        [verificationId, new Date(), errorExport],
        input,
      );
    }
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

  private runInBackground(
    info: Pick<
      RunningTask,
      "verificationId" | "functionName" | "chainId" | "address"
    >,
    promise: Promise<void>,
  ): void {
    const task: RunningTask = {
      ...info,
      startedAt: new Date(),
      promise: promise.finally(() => {
        clearTimeout(task.timeoutTimer);
        this.runningTasks.delete(info.verificationId);
      }),
    };
    this.runningTasks.set(info.verificationId, task);
  }
}
