import {
  SolidityJsonInput,
  VerificationExport,
  CompilationTarget, Metadata
} from "@ethereum-sourcify/lib-sourcify";
import { ConflictError } from "../../common/errors/ConflictError";
import { asyncLocalStorage } from "../../common/async-context";
import { VerificationJobId } from "../../routes/types";
import Piscina from "piscina";
import path from "path";
import { filename as verificationWorkerFilename } from "../workers/verificationWorker";
import { v4 as uuidv4 } from "uuid";
import os from "os";
import {
  VerifyError,
  VerifyErrorExport,
  VerifyFromEtherscanInput,
  type VerifyFromJsonInput, VerifyFromMetadataInput,
  type VerifyOutput
} from "../workers/workerTypes";
import { EtherscanResult } from "../utils/etherscan-util";
import { StoreService } from "../store/StoreService";
import { ChainMap } from "../../server";
import { ChainInstance } from "../../config/Loader";

export interface VerificationOptions {
  chains: ChainMap;
  solcRepoPath: string;
  solJsonRepoPath: string;
  workerIdleTimeout?: number;
  concurrentVerificationsPerWorker?: number;
}

export class VerificationService {
  private store: StoreService;
  private workerPool: Piscina;
  private runningTasks: Set<Promise<void>> = new Set();

  constructor(
    options: VerificationOptions,
    store: StoreService,
  ) {
    this.store = store;

    const chains = Object.entries(
      options.chains,
    ).reduce(
      (acc, [chainId, chain]) => {
        acc[chainId] = chain.getSourcifyChainObj();
        return acc;
      },
      {} as Record<string, ChainInstance>,
    );

    this.workerPool = new Piscina({
      filename: path.resolve(__dirname, "../workers/workerWrapper.js"),
      workerData: {
        fullpath: verificationWorkerFilename,
        solcRepoPath: options.solcRepoPath,
        solJsonRepoPath: options.solJsonRepoPath,
        chains,
      },
      minThreads: os.availableParallelism() * 0.5,
      maxThreads: os.availableParallelism() * 1.5,
      idleTimeout: options.workerIdleTimeout || 30000,
      concurrentTasksPerWorker: options.concurrentVerificationsPerWorker || 5,
    });
  }

  public async close() {
    // Immediately abort all workers. Tasks that still run will have their Promises rejected.
    await this.workerPool.destroy();
    // Here, we wait for the rejected tasks which also waits for writing the failed status to the database.
    await Promise.all(this.runningTasks);
  }

  public async verifyFromJsonInputViaWorker(
    verificationEndpoint: string,
    chainId: number,
    address: string,
    jsonInput: SolidityJsonInput,
    compilerVersion: string,
    compilationTarget: CompilationTarget,
    creationTransactionHash?: string,
  ): Promise<VerificationJobId> {
    const verificationId = await this.store.storeVerificationJob(new Date(), chainId, address, verificationEndpoint)

    const input: VerifyFromJsonInput = {
      chainId,
      address,
      jsonInput,
      compilerVersion,
      compilationTarget,
      creationTransactionHash,
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    const task = this.workerPool
      .run(input, { name: "verifyFromJsonInput" })
      .then((output: VerifyOutput) => {
        return this.handleWorkerResponse(verificationId, output);
      })
      .finally(() => {
        this.runningTasks.delete(task);
      });
    this.runningTasks.add(task);

    return verificationId;
  }

  public async verifyFromMetadataViaWorker(
    verificationEndpoint: string,
    chainId: number,
    address: string,
    metadata: Metadata,
    sources: Record<string, string>,
    creationTransactionHash?: string,
  ): Promise<VerificationJobId> {
    const verificationId = await this.store.storeVerificationJob(new Date(), chainId, address, verificationEndpoint)

    const input: VerifyFromMetadataInput = {
      chainId,
      address,
      metadata,
      sources,
      creationTransactionHash,
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    const task = this.workerPool
      .run(input, { name: "verifyFromMetadata" })
      .then((output: VerifyOutput) => {
        return this.handleWorkerResponse(verificationId, output);
      })
      .finally(() => {
        this.runningTasks.delete(task);
      });
    this.runningTasks.add(task);

    return verificationId;
  }

  private async handleWorkerResponse(
    verificationId: VerificationJobId,
    output: VerifyOutput,
  ): Promise<void> {
    return Promise.resolve(output)
      .then((output: VerifyOutput) => {
        if (output.verificationExport) {
          return output.verificationExport;
        } else if (output.errorExport) {
          throw new VerifyError(output.errorExport);
        }
        const errorMessage = `The worker did not return a verification export nor an error export. This should never happen.`;
        console.error(errorMessage, { output });
        throw new Error(errorMessage);
      })
      .then((verification: VerificationExport) => {
        return this.store.storeVerification(verification, {
          verificationId,
          finishTime: new Date(),
        });
      })
      .catch((error) => {
        let errorExport: VerifyErrorExport;
        if (error instanceof VerifyError) {
          // error comes from the verification worker
          console.debug("Received verification error from worker", {
            verificationId,
            errorExport: error.errorExport,
          });
          errorExport = error.errorExport;
        } else if (error instanceof ConflictError) {
          // returned by StorageService if match already exists and new one is not better
          errorExport = {
            customCode: "already_verified",
            errorId: uuidv4(),
          };
        } else {
          console.error("Unexpected verification error", {
            verificationId,
            error,
          });
          errorExport = {
            customCode: "internal_error",
            errorId: uuidv4(),
          };
        }

        return this.store.setJobError(verificationId, new Date(), errorExport)
      });
  }
}
