import type { Metadata, VyperJsonInput, SolidityJsonInput,
  CompilationTarget,
} from "@ethereum-sourcify/lib-sourcify";
import { TypedResponse } from "../../types";
import { Request } from "express";
import { Services } from "../../../services/services";
import { StatusCodes } from "http-status-codes";
import { fetchFromEtherscan } from "../../../services/utils/etherscan-util";
import { SourcifyChainMap } from "@ethereum-sourcify/lib-sourcify/build/main/SourcifyChain/SourcifyChainTypes";
import { getChainId } from "../errors";

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
  console.debug("verifyFromJsonInputEndpoint", {
    chainId: req.params.chainId,
    address: req.params.address,
    stdJsonInput: req.body.stdJsonInput,
    compilerVersion: req.body.compilerVersion,
    contractIdentifier: req.body.contractIdentifier,
    creationTransactionHash: req.body.creationTransactionHash,
  });

  // The contract path can include a colon itself. Therefore,
  // we need to take the last element as the contract name.
  const splitIdentifier = req.body.contractIdentifier.split(":");
  const contractName = splitIdentifier[splitIdentifier.length - 1];
  const contractPath = splitIdentifier.slice(0, -1).join(":");
  const compilationTarget: CompilationTarget = {
    name: contractName,
    path: contractPath,
  };

  const services = req.app.get("services") as Services;
  const chain = getChainId(req.params.chainId)
  const verificationId = await services.verification.verifyFromJsonInputViaWorker(
      req.baseUrl + req.path,
      chain,
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
  console.debug("verifyFromMetadataEndpoint", {
    chainId: req.params.chainId,
    address: req.params.address,
    sources: req.body.sources,
    metadata: req.body.metadata,
    creationTransactionHash: req.body.creationTransactionHash,
  });

  const services = req.app.get("services") as Services;
  const chain = getChainId(req.params.chainId)
  const verificationId = await services.verification.verifyFromMetadataViaWorker(
      req.baseUrl + req.path,
      chain,
      req.params.address,
      req.body.metadata,
      req.body.sources,
      req.body.creationTransactionHash,
    );

  res.status(StatusCodes.ACCEPTED).json({ verificationId });
}
