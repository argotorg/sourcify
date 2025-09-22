import {
  SolidityJsonInput,
  VerificationExport,
  CompilationTarget,
  Metadata,
} from "@ethereum-sourcify/lib-sourcify";
import { ConflictError } from "../../common/errors";
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
  VerifyFromConfluxscanInput,
  type VerifyFromJsonInput,
  VerifyFromMetadataInput,
  type VerifyOutput,
} from "../workers/workerTypes";
import { ConfluxscanResult } from "../utils/confluxscan-util";
import { StoreService } from "../store/StoreService";
import { ChainMap } from "../../server";
import { ChainInstance } from "../../config/Loader";
import {
  findSolcPlatform,
  getSolcExecutable,
  getSolcJs,
} from "@ethereum-sourcify/compilers";
import { keccak256 } from "ethers";

export interface VerificationOptions {
  chains: ChainMap;
  solcRepoPath: string;
  solJsonRepoPath: string;
  vyperRepoPath: string;
  initCompilers?: boolean;
  workerIdleTimeout?: number;
  concurrentVerificationsPerWorker?: number;
}

export class VerificationService {
  private readonly initCompilers: boolean | undefined;
  private solcRepoPath: string;
  private solJsonRepoPath: string;
  private chains: ChainMap;
  private store: StoreService;
  private workerPool: Piscina;
  private runningTasks: Set<Promise<void>> = new Set();
  public runningTaskIds: Set<string> = new Set();

  constructor(options: VerificationOptions, store: StoreService) {
    this.initCompilers = options.initCompilers;
    this.solcRepoPath = options.solcRepoPath;
    this.solJsonRepoPath = options.solJsonRepoPath;
    this.chains = options.chains;
    this.store = store;

    const chains = Object.entries(options.chains).reduce(
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
        vyperRepoPath: options.vyperRepoPath,
        chains,
      },
      minThreads: os.availableParallelism() * 0.5,
      maxThreads: os.availableParallelism() * 1.5,
      idleTimeout: options.workerIdleTimeout || 30000,
      concurrentTasksPerWorker: options.concurrentVerificationsPerWorker || 5,
    });
  }

  public async init() {
    const HOST_SOLC_REPO = "https://binaries.soliditylang.org/";

    if (this.initCompilers) {
      const platform = findSolcPlatform() || "bin"; // fallback to emscripten binaries "bin"
      console.info(`Initializing compilers for platform ${platform}`);

      // solc binary and solc-js downloads are handled with different helpers
      const downLoadFunc =
        platform === "bin"
          ? (version: string) => getSolcJs(this.solJsonRepoPath, version)
          : // eslint-disable-next-line indent
            (version: string) =>
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
            console.debug(
              `Downloaded (or found existing) compiler ${solcVer} in ${Date.now() - now}ms`,
            );
          });
        });

        await Promise.all(promises);
        console.debug(
          `Batch ${i / chunkSize + 1} - Downloaded ${promises.length} - Total ${i + chunkSize}/${solcList.length}`,
        );
      }

      console.info("Initialized compilers");
    }
    return true;
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
    licenseType?: number,
    contractLabel?: string,
  ): Promise<VerificationJobId> {
    const verificationId = await this.store.storeVerificationJob(
      new Date(),
      chainId,
      address,
      verificationEndpoint,
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

    const task = this.workerPool
      .run(input, { name: "verifyFromJsonInput" })
      .then((output: VerifyOutput) => {
        return this.handleWorkerResponse(
          verificationId,
          output,
          licenseType,
          contractLabel,
        );
      })
      .finally(() => {
        this.runningTaskIds.delete(verificationId);
        this.runningTasks.delete(task);
      });
    this.runningTaskIds.add(verificationId);
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
    const verificationId = await this.store.storeVerificationJob(
      new Date(),
      chainId,
      address,
      verificationEndpoint,
    );

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
        this.runningTaskIds.delete(verificationId);
        this.runningTasks.delete(task);
      });
    this.runningTaskIds.add(verificationId);
    this.runningTasks.add(task);

    return verificationId;
  }

  public async verifyFromConfluxscanViaWorker(
    verificationEndpoint: string,
    chainId: number,
    address: string,
    etherscanResult: ConfluxscanResult,
  ): Promise<VerificationJobId> {
    const verificationId = await this.store.storeVerificationJob(
      new Date(),
      chainId,
      address,
      verificationEndpoint,
    );

    const input: VerifyFromConfluxscanInput = {
      chainId,
      address,
      confluxscanResult: etherscanResult,
      traceId: asyncLocalStorage.getStore()?.traceId,
    };

    const task = this.workerPool
      .run(input, { name: "verifyFromConfluxscan" })
      .then((output: VerifyOutput) => {
        return this.handleWorkerResponse(verificationId, output);
      })
      .finally(() => {
        this.runningTaskIds.delete(verificationId);
        this.runningTasks.delete(task);
      });
    this.runningTaskIds.add(verificationId);
    this.runningTasks.add(task);

    return verificationId;
  }

  public async verifyFromCrossChainViaWorker(
    verificationEndpoint: string,
    chainId: number,
    address: string,
  ): Promise<VerificationJobId> {
    const verificationId = await this.store.storeVerificationJob(
      new Date(),
      chainId,
      address,
      verificationEndpoint,
    );

    try {
      const chain = this.chains[chainId];
      const bytecode = await chain.getBytecode(address);
      const codeHash = keccak256(bytecode);
      await this.store.insertNewSimilarContract(chainId, address, codeHash);
    } catch (error) {
      let errorExport: VerifyErrorExport;
      if (`${error}`.includes("Failed to find contract-deployment.")) {
        errorExport = {
          customCode: "no_similar_match_found",
          errorId: uuidv4(),
        };
      } else {
        errorExport = {
          customCode: "internal_error",
          errorId: uuidv4(),
        };
      }
      await this.store.setJobError(verificationId, new Date(), errorExport);
    }

    return verificationId;
  }

  private async handleWorkerResponse(
    verificationId: VerificationJobId,
    output: VerifyOutput,
    licenseType?: number,
    contractLabel?: string,
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
        return this.store.storeVerification(
          verification,
          {
            verificationId,
            finishTime: new Date(),
          },
          licenseType,
          contractLabel,
        );
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

        return this.store.setJobError(verificationId, new Date(), errorExport);
      });
  }

  public isRunning(verificationId: string): boolean {
    return this.runningTaskIds.has(verificationId);
  }
}
