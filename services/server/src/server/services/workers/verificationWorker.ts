import Piscina from "piscina";
import type {
  SourcifyChainInstance,
  SourcifyChainMap,
  AnyCompilation,
  SolidityCompilation,
  VyperCompilation,
} from "@ethereum-sourcify/lib-sourcify";
import {
  Verification,
  SourcifyLibError,
  SourcifyChain,
  SolidityMetadataContract,
  useAllSourcesAndReturnCompilation,
  EtherscanUtils,
} from "@ethereum-sourcify/lib-sourcify";
import { resolve } from "path";
import { writeFileSync } from "fs";
import { isMainThread, parentPort, threadId } from "node:worker_threads";
import { ChainRepository } from "../../../sourcify-chain-repository";
import { SolcLocal } from "../compiler/local/SolcLocal";
import { VyperLocal } from "../compiler/local/VyperLocal";
import { FeLocal } from "../compiler/local/FeLocal";
import { v4 as uuidv4 } from "uuid";
import { getCreatorTx } from "../utils/contract-creation-util";
import type {
  VerifyErrorExport,
  VerifyFromEtherscanInput,
  VerifyFromJsonInput,
  VerifyFromMetadataInput,
  VerifyOutput,
  VerificationWorkerInput,
  VerifySimilarityInput,
  WorkerTaskStartMessage,
} from "./workerTypes";
import logger, { setLogLevel } from "../../../common/logger";
import { asyncLocalStorage } from "../../../common/async-context";
import SourcifyChainMock from "../utils/SourcifyChainMock";
import { createPreRunCompilationFromStoredCandidate } from "../utils/database-util";
import { createCompilationFromJsonInput } from "../utils/compilation";

export const filename = resolve(__filename);

function setThreadName(name: string) {
  try {
    writeFileSync("/proc/thread-self/comm", name.slice(0, 15));
  } catch {
    // Not Linux or not permitted. The name is only a diagnostic aid.
  }
}

// The main thread also imports this module for `filename`
if (!isMainThread) {
  setThreadName(`sfy-pool-${threadId}`);
}

let chainRepository: ChainRepository;
let solc: SolcLocal;
let vyper: VyperLocal;
let fe: FeLocal;
const initWorker = () => {
  if (chainRepository && solc && vyper && fe) {
    return;
  }

  setLogLevel(Piscina.workerData.logLevel || "info");

  if (Piscina.workerData.ipfsGateway) {
    SolidityMetadataContract.setGlobalIpfsGateway(
      Piscina.workerData.ipfsGateway,
    );
  }

  const sourcifyChainInstanceMap = Piscina.workerData
    .sourcifyChainInstanceMap as { [chainId: string]: SourcifyChainInstance };

  const sourcifyChainMap = Object.entries(sourcifyChainInstanceMap).reduce(
    (acc, [chainId, chain]) => {
      acc[chainId] = new SourcifyChain(chain);
      return acc;
    },
    {} as SourcifyChainMap,
  );

  chainRepository = new ChainRepository(sourcifyChainMap);
  solc = new SolcLocal(
    Piscina.workerData.solcRepoPath,
    Piscina.workerData.solJsonRepoPath,
    Piscina.workerData.compilerTimeoutMs,
  );
  vyper = new VyperLocal(
    Piscina.workerData.vyperRepoPath,
    Piscina.workerData.compilerTimeoutMs,
  );
  fe = new FeLocal(
    Piscina.workerData.feRepoPath,
    Piscina.workerData.compilerTimeoutMs,
  );
};

async function runWorkerFunctionWithContext<T extends VerificationWorkerInput>(
  workerFunction: (input: T) => Promise<VerifyOutput>,
  input: T,
): Promise<VerifyOutput> {
  // Tells the main thread which job runs on this thread. A task that blocks
  // the thread can never send anything later, so this goes out before any
  // work. parentPort is null when the function runs outside of a worker.
  const taskStart: WorkerTaskStartMessage = {
    type: "task-start",
    threadId,
    verificationId: input.verificationId,
  };
  parentPort?.postMessage(taskStart);
  initWorker();
  // We need to inject the traceId for the logger here since the worker is running in its own thread.
  const context = { traceId: input.traceId };
  return asyncLocalStorage.run(context, workerFunction, input);
}

export async function verifyFromJsonInput(
  input: VerifyFromJsonInput,
): Promise<VerifyOutput> {
  return runWorkerFunctionWithContext(_verifyFromJsonInput, input);
}

export async function verifyFromMetadata(
  input: VerifyFromMetadataInput,
): Promise<VerifyOutput> {
  return runWorkerFunctionWithContext(_verifyFromMetadata, input);
}

export async function verifyFromEtherscan(
  input: VerifyFromEtherscanInput,
): Promise<VerifyOutput> {
  return runWorkerFunctionWithContext(_verifyFromEtherscan, input);
}

export async function verifySimilarity(
  input: VerifySimilarityInput,
): Promise<VerifyOutput> {
  return runWorkerFunctionWithContext(_verifySimilarity, input);
}

async function _verifyFromJsonInput({
  chainId,
  address,
  jsonInput,
  compilerVersion,
  compilationTarget,
  creationTransactionHash,
}: VerifyFromJsonInput): Promise<VerifyOutput> {
  let compilation: AnyCompilation;
  try {
    compilation = createCompilationFromJsonInput(
      { solc, vyper, fe },
      compilerVersion,
      jsonInput,
      compilationTarget,
    );
  } catch (error: any) {
    return {
      errorExport: createErrorExport(error),
    };
  }

  if (!compilation) {
    return {
      errorExport: {
        customCode: "unsupported_language",
        errorId: uuidv4(),
      },
    };
  }

  const sourcifyChain = chainRepository.sourcifyChainMap[chainId];
  const foundCreationTxHash =
    creationTransactionHash ||
    (await getCreatorTx(sourcifyChain, address)) ||
    undefined;

  const verification = new Verification(
    compilation,
    sourcifyChain,
    address,
    foundCreationTxHash,
  );

  try {
    await verification.verify();
  } catch (error: any) {
    return {
      errorExport: createErrorExport(error, verification),
    };
  }

  return {
    verificationExport: verification.export(),
  };
}

async function _verifyFromMetadata({
  chainId,
  address,
  metadata,
  sources,
  creationTransactionHash,
}: VerifyFromMetadataInput): Promise<VerifyOutput> {
  const sourcesList = Object.entries(sources).map(([path, content]) => ({
    path,
    content,
  }));
  const metadataContract = new SolidityMetadataContract(metadata, sourcesList);

  let compilation: SolidityCompilation;
  try {
    // Includes fetching missing sources
    compilation = await metadataContract.createCompilation(solc);
  } catch (error: any) {
    return {
      errorExport: createErrorExport(error),
    };
  }

  const sourcifyChain = chainRepository.sourcifyChainMap[chainId];
  const foundCreationTxHash =
    creationTransactionHash ||
    (await getCreatorTx(sourcifyChain, address)) ||
    undefined;

  let verification = new Verification(
    compilation,
    sourcifyChain,
    address,
    foundCreationTxHash,
  );

  try {
    await verification.verify();
  } catch (error: any) {
    if (error.code !== "extra_file_input_bug") {
      return {
        errorExport: createErrorExport(error, verification),
      };
    }

    logger.info("Found extra-file-input-bug", {
      contract: metadataContract.name,
      chainId,
      address,
    });

    const sourcesBuffer = sourcesList.map(({ path, content }) => ({
      path,
      buffer: Buffer.from(content),
    }));
    const compilationWithAllSources = await useAllSourcesAndReturnCompilation(
      compilation,
      sourcesBuffer,
    );
    verification = new Verification(
      compilationWithAllSources,
      sourcifyChain,
      address,
      foundCreationTxHash,
    );

    try {
      await verification.verify();
    } catch (allSourcesError: any) {
      return {
        errorExport: createErrorExport(allSourcesError, verification),
      };
    }
  }

  return {
    verificationExport: verification.export(),
  };
}

async function _verifyFromEtherscan({
  verificationId,
  chainId,
  address,
  etherscanResult,
}: VerifyFromEtherscanInput): Promise<VerifyOutput> {
  let compilation: SolidityCompilation | VyperCompilation;
  try {
    compilation = await EtherscanUtils.getCompilationFromEtherscanResult(
      etherscanResult,
      solc,
      vyper,
    );
  } catch (error: any) {
    return {
      errorExport: createErrorExport(error),
    };
  }

  return _verifyFromJsonInput({
    verificationId,
    chainId,
    address,
    jsonInput: compilation.jsonInput,
    compilerVersion: compilation.compilerVersion,
    compilationTarget: compilation.compilationTarget,
  });
}

async function _verifySimilarity({
  chainId,
  address,
  runtimeBytecode,
  creationData,
  candidates,
}: VerifySimilarityInput): Promise<VerifyOutput> {
  const resolvedCreatorTxHash = creationData.creationTransactionHash;

  const mockChain = new SourcifyChainMock(
    {
      onchain_runtime_code: runtimeBytecode,
      onchain_creation_code: creationData.creationBytecode,
      deployer: creationData.deployer,
      block_number: creationData.blockNumber,
      transaction_index: creationData.txIndex,
      transaction_hash: resolvedCreatorTxHash,
    },
    Number(chainId),
    address,
  );

  for (const candidate of candidates) {
    let compilation;
    try {
      compilation = createPreRunCompilationFromStoredCandidate(
        { solc, vyper, fe },
        candidate,
      );
    } catch (error: any) {
      logger.warn("Failed to create compilation from similarity candidate", {
        chainId,
        address: address,
        error: error.message,
      });
      continue;
    }

    const verification = new Verification(
      compilation,
      mockChain,
      address,
      resolvedCreatorTxHash,
    );

    try {
      await verification.verify();
    } catch (error: any) {
      if (error instanceof SourcifyLibError) {
        logger.debug("Similarity candidate verification failed", {
          chainId,
          address: address,
          error: error.code,
        });
        continue;
      }

      logger.warn("Unexpected error during similarity candidate verification", {
        chainId,
        address: address,
        error: error?.message,
      });
      throw new Error(
        `Unexpected error during similarity candidate verification: ${error.message}`,
      );
    }

    const { runtimeMatch, creationMatch } = verification.status;

    if (runtimeMatch !== null || creationMatch !== null) {
      logger.info("Similarity verification matched candidate", {
        chainId,
        address: address,
      });
      return {
        verificationExport: verification.export(),
      };
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

function createErrorExport(
  error: Error,
  verification?: Verification,
): VerifyErrorExport {
  if (!(error instanceof SourcifyLibError)) {
    // If the error is not a SourcifyLibError, the server reached an unexpected state.
    // Let the VerificationService log and handle it.
    throw error;
  }

  // Use VerificationExport to get bytecodes as it does not throw when accessing properties
  const verificationExport = verification?.export();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { chainId, address, ...jobErrorData } = error.data;

  return {
    customCode: error.code,
    errorId: uuidv4(),
    errorData: Object.keys(jobErrorData).length > 0 ? jobErrorData : undefined,
    onchainRuntimeCode: verificationExport?.onchainRuntimeBytecode,
    onchainCreationCode: verificationExport?.onchainCreationBytecode,
    recompiledRuntimeCode: verificationExport?.compilation.runtimeBytecode,
    recompiledCreationCode: verificationExport?.compilation.creationBytecode,
    creationTransactionHash: verificationExport?.deploymentInfo.txHash,
  };
}
