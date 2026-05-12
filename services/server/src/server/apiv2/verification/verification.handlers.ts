import type {
  VyperJsonInput,
  SolidityJsonInput,
  FeJsonInput,
  CompilationTarget,
  Metadata,
} from "@ethereum-sourcify/lib-sourcify";
import { splitFullyQualifiedName } from "@ethereum-sourcify/lib-sourcify";
import type { TypedResponse } from "../../types";
import logger from "../../../common/logger";
import type { Request } from "express";
import type { Services } from "../../services/services";
import { StatusCodes } from "http-status-codes";
import { InvalidParametersError } from "../errors";
import { fetchFromEtherscanOrThrowError } from "../../services/utils/etherscan-util";
import type { ChainRepository } from "../../../sourcify-chain-repository";

type ZkSolcRequestBody = {
  zksolcVersion?: string;
};

type ZkSolcSettings = SolidityJsonInput["settings"] & {
  isSystem?: boolean;
  forceEvmla?: boolean;
  enableEraVMExtensions?: boolean;
  forceEVMLA?: boolean;
};

interface VerifyFromJsonInputRequest extends Request {
  params: {
    chainId: string;
    address: string;
  };
  body: ZkSolcRequestBody & {
    stdJsonInput: SolidityJsonInput | VyperJsonInput | FeJsonInput;
    compilerVersion: string;
    contractIdentifier: string;
    creationTransactionHash?: string;
  };
}

type VerifyResponse = TypedResponse<{
  verificationId: string;
}>;

function getZkSolcVersion(body: ZkSolcRequestBody): string | undefined {
  return body.zksolcVersion;
}

function hasZkSolcInputFlags(
  stdJsonInput: SolidityJsonInput | VyperJsonInput | FeJsonInput,
): boolean {
  const settings = stdJsonInput.settings as ZkSolcSettings | undefined;
  if (!settings) {
    return false;
  }

  return (
    "enableEraVMExtensions" in settings ||
    "forceEVMLA" in settings ||
    "isSystem" in settings ||
    "forceEvmla" in settings
  );
}

export async function verifyFromJsonInputEndpoint(
  req: VerifyFromJsonInputRequest,
  res: VerifyResponse,
) {
  const zksolcVersion = getZkSolcVersion(req.body);
  const isZkSolcVerification =
    Boolean(zksolcVersion) || hasZkSolcInputFlags(req.body.stdJsonInput);

  logger.debug("verifyFromJsonInputEndpoint", {
    chainId: req.params.chainId,
    address: req.params.address,
    compilerVersion: req.body.compilerVersion,
    zksolcVersion,
    isZkSolcVerification,
    contractIdentifier: req.body.contractIdentifier,
    creationTransactionHash: req.body.creationTransactionHash,
  });

  // The contract path can include a colon itself. Therefore,
  // we need to take the last element as the contract name.
  const { contractName, contractPath } = splitFullyQualifiedName(
    req.body.contractIdentifier,
  );
  const compilationTarget: CompilationTarget = {
    name: contractName,
    path: contractPath,
  };

  const services = req.app.get("services") as Services;
  if (isZkSolcVerification) {
    if (req.body.stdJsonInput.language !== "Solidity") {
      throw new InvalidParametersError(
        "ZkSolc verification only supports Solidity standard JSON input.",
      );
    }
    if (!zksolcVersion) {
      throw new InvalidParametersError(
        "zksolcVersion is required when zksolc-specific settings are provided.",
      );
    }

    const verificationId =
      await services.verification.verifyFromZkSolcJsonInputViaWorker(
        req.baseUrl + req.path,
        req.params.chainId,
        req.params.address,
        req.body.stdJsonInput,
        zksolcVersion,
        req.body.compilerVersion,
        compilationTarget,
        req.body.creationTransactionHash,
      );

    res.status(StatusCodes.ACCEPTED).json({ verificationId });
    return;
  }

  const verificationId =
    await services.verification.verifyFromJsonInputViaWorker(
      req.baseUrl + req.path,
      req.params.chainId,
      req.params.address,
      req.body.stdJsonInput,
      req.body.compilerVersion,
      compilationTarget,
      req.body.creationTransactionHash,
    );

  res.status(StatusCodes.ACCEPTED).json({ verificationId });
}

interface VerifyFromMetadataRequest extends Request {
  params: {
    chainId: string;
    address: string;
  };
  body: {
    metadata: Metadata;
    sources: Record<string, string>;
    creationTransactionHash?: string;
  };
}

export async function verifyFromMetadataEndpoint(
  req: VerifyFromMetadataRequest,
  res: VerifyResponse,
) {
  logger.debug("verifyFromMetadataEndpoint", {
    chainId: req.params.chainId,
    address: req.params.address,
    sources: req.body.sources,
    creationTransactionHash: req.body.creationTransactionHash,
  });

  const services = req.app.get("services") as Services;
  const verificationId =
    await services.verification.verifyFromMetadataViaWorker(
      req.baseUrl + req.path,
      req.params.chainId,
      req.params.address,
      req.body.metadata,
      req.body.sources,
      req.body.creationTransactionHash,
    );

  res.status(StatusCodes.ACCEPTED).json({ verificationId });
}

interface VerifyFromEtherscanRequest extends Request {
  params: {
    chainId: string;
    address: string;
  };
  body: {
    apiKey?: string;
  };
}

export async function verifyFromEtherscanEndpoint(
  req: VerifyFromEtherscanRequest,
  res: VerifyResponse,
) {
  logger.debug("verifyFromEtherscanEndpoint", {
    chainId: req.params.chainId,
    address: req.params.address,
  });

  const services = req.app.get("services") as Services;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;

  // Fetch here to give early feedback to the user.
  // Then, process in worker.
  const etherscanResult = await fetchFromEtherscanOrThrowError(
    chainRepository.supportedChainMap[req.params.chainId],
    req.params.address,
    req.body?.apiKey,
    true,
  );

  const verificationId =
    await services.verification.verifyFromEtherscanViaWorker(
      req.baseUrl + req.path,
      req.params.chainId,
      req.params.address,
      etherscanResult,
    );

  res.status(StatusCodes.ACCEPTED).json({ verificationId });
}

interface VerifySimilarityRequest extends Request {
  params: {
    chainId: string;
    address: string;
  };
  body: {
    creationTransactionHash?: string;
  };
}

export async function verifySimilarityEndpoint(
  req: VerifySimilarityRequest,
  res: VerifyResponse,
) {
  logger.debug("verifySimilarityEndpoint", {
    chainId: req.params.chainId,
    address: req.params.address,
    creationTransactionHash: req.body.creationTransactionHash,
  });

  const services = req.app.get("services") as Services;

  const verificationId =
    await services.verification.verifyFromSimilarityViaWorker(
      req.baseUrl + req.path,
      req.params.chainId,
      req.params.address,
      req.body.creationTransactionHash,
    );

  res.status(StatusCodes.ACCEPTED).json({ verificationId });
}
