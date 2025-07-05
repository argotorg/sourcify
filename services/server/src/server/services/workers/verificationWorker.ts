import Piscina from "piscina";
import {
  SolidityJsonInput,
  VyperJsonInput,
  SolidityCompilation,
  VyperCompilation,
  Verification,
  SourcifyLibError,
  SourcifyChain,
  SourcifyChainInstance,
  SourcifyChainMap,
  SolidityMetadataContract,
  useAllSourcesAndReturnCompilation,
} from "@ethereum-sourcify/lib-sourcify";
import { resolve } from "path";
import { ChainRepository } from "../../../sourcify-chain-repository";
import { SolcLocal } from "../compiler/local/SolcLocal";
import { VyperLocal } from "../compiler/local/VyperLocal";
import { v4 as uuidv4 } from "uuid";
import { getCreatorTx } from "../utils/contract-creation-util";
import type {
  VerifyErrorExport,
  VerifyFromEtherscanInput,
  VerifyFromJsonInput,
  VerifyFromMetadataInput,
  VerifyOutput,
  VerificationWorkerInput,
} from "./workerTypes";
import logger, { setLogLevel } from "../../../common/logger";
import {
  ProcessedEtherscanResult,
  isVyperResult,
  processSolidityResultFromEtherscan,
  processVyperResultFromEtherscan,
} from "../utils/etherscan-util";
import { asyncLocalStorage } from "../../../common/async-context";

export const filename = resolve(__filename);

let chainRepository: ChainRepository;
let solc: SolcLocal;
let vyper: VyperLocal;

const initWorker = () => {
  if (chainRepository && solc && vyper) {
    return;
  }

  setLogLevel(Piscina.workerData.logLevel || "info");

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
  );
  vyper = new VyperLocal(Piscina.workerData.vyperRepoPath);
};

async function runWorkerFunctionWithContext<T extends VerificationWorkerInput>(
  workerFunction: (input: T) => Promise<VerifyOutput>,
  input: T,
): Promise<VerifyOutput> {
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

async function _verifyFromJsonInput({
  chainId,
  address,
  jsonInput,
  compilerVersion,
  compilationTarget,
  creationTransactionHash,
}: VerifyFromJsonInput): Promise<VerifyOutput> {
  let compilation: SolidityCompilation | VyperCompilation | undefined;
  try {
    if (jsonInput.language === "Solidity") {
      compilation = new SolidityCompilation(
        solc,
        compilerVersion,
        jsonInput as SolidityJsonInput,
        compilationTarget,
      );
    } else if (jsonInput.language === "Vyper") {
      compilation = new VyperCompilation(
        vyper,
        compilerVersion,
        jsonInput as VyperJsonInput,
        compilationTarget,
      );
    }
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
  chainId,
  address,
  etherscanResult,
}: VerifyFromEtherscanInput): Promise<VerifyOutput> {
  let processedResult: ProcessedEtherscanResult;
  if (isVyperResult(etherscanResult)) {
    processedResult = await processVyperResultFromEtherscan(
      etherscanResult,
      true,
    );
  } else {
    processedResult = processSolidityResultFromEtherscan(etherscanResult, true);
  }

  return _verifyFromJsonInput({
    chainId,
    address,
    jsonInput: processedResult.jsonInput,
    compilerVersion: processedResult.compilerVersion,
    compilationTarget: {
      name: processedResult.contractName,
      path: processedResult.contractPath,
    },
  });
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
