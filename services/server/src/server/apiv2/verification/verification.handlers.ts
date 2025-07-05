import type {
  VyperJsonInput,
  SolidityJsonInput,
  CompilationTarget,
  Metadata,
} from "@ethereum-sourcify/lib-sourcify";
import { splitFullyQualifiedName } from "@ethereum-sourcify/lib-sourcify";
import { TypedResponse } from "../../types";
import logger from "../../../common/logger";
import { Request } from "express";
import { Services } from "../../services/services";
import { StatusCodes } from "http-status-codes";
import { fetchFromEtherscan } from "../../services/utils/etherscan-util";
import { ChainRepository } from "../../../sourcify-chain-repository";

interface VerifyFromJsonInputRequest extends Request {
  params: {
    chainId: string;
    address: string;
  };
  body: {
    stdJsonInput: SolidityJsonInput | VyperJsonInput;
    compilerVersion: string;
    contractIdentifier: string;
    creationTransactionHash?: string;
  };
}

type VerifyResponse = TypedResponse<{
  verificationId: string;
}>;

export async function verifyFromJsonInputEndpoint(
  req: VerifyFromJsonInputRequest,
  res: VerifyResponse,
) {
  logger.debug("verifyFromJsonInputEndpoint", {
    chainId: req.params.chainId,
    address: req.params.address,
    compilerVersion: req.body.compilerVersion,
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
    metadata: req.body.metadata,
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
  const etherscanResult = await fetchFromEtherscan(
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
