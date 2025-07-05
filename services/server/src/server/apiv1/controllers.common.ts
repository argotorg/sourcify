import { Request, Response, NextFunction } from "express";
import { getAddress } from "ethers";
import { BadRequestError, InternalServerError } from "../../common/errors";
import logger from "../../common/logger";
import { isContractAlreadyPerfect } from "./verification/verification.common";
import { Services } from "../services/services";
import {
  ImmutableReferences,
  StringMap,
  Transformation,
  TransformationValues,
  Verification,
  VerificationStatus,
} from "@ethereum-sourcify/lib-sourcify";
import { Match } from "../types";

export function checksumAddresses(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // stateless
  if (req.body?.address) {
    req.body.address = getAddress(req.body.address);
  }
  // session
  if (req.body?.contracts) {
    req.body.contracts.forEach((contract: any) => {
      contract.address = getAddress(contract.address);
    });
  }
  if (req.query.addresses) {
    req.query.addresses = (req.query.addresses as string)
      .split(",")
      .map((address: string) => getAddress(address))
      .join(",");
  }
  next();
}

export function validateAddress(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.params.address) {
    try {
      // Checksum the address
      req.params.address = getAddress(req.params.address);
    } catch (err: any) {
      logger.info("Invalid address in params", {
        errorMessage: err.message,
        errorStack: err.stack,
        params: req.params,
      });
      return next(
        new BadRequestError(`Invalid address: ${req.params.address}`),
      );
    }
  }
  next();
}

export async function checkPerfectMatch(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // address and chain are always available because of openAPI validation
  const { address, chain } = req.body ?? {};
  const services = req.app.get("services") as Services;

  try {
    const result = await isContractAlreadyPerfect(
      services.storage,
      address,
      chain,
    );

    if (result) {
      res.send({ result: [getApiV1ResponseFromMatch(result)] });
      return;
    }

    next();
  } catch (error: any) {
    logger.error("Error in checkPerfectMatch:", {
      error,
      address,
      chain,
    });
    return next(
      new InternalServerError(
        "Error while checking for existing perfect match",
      ),
    );
  }
}

export interface ApiV1Response
  extends Omit<Match, "runtimeMatch" | "creationMatch"> {
  abiEncodedConstructorArguments?: string;
  libraryMap?: StringMap;
  creatorTxHash?: string;
  immutableReferences?: ImmutableReferences;
  runtimeTransformations?: Transformation[];
  creationTransformations?: Transformation[];
  runtimeTransformationValues?: TransformationValues;
  creationTransformationValues?: TransformationValues;
  onchainCreationBytecode?: string;
  blockNumber?: number;
  txIndex?: number;
  deployer?: string;
  status: VerificationStatus;
}

export function getMatchStatus(
  verificationStatus: Verification["status"],
): VerificationStatus {
  if (
    verificationStatus.runtimeMatch === "perfect" ||
    verificationStatus.creationMatch === "perfect"
  ) {
    return "perfect";
  }
  if (
    verificationStatus.runtimeMatch === "partial" ||
    verificationStatus.creationMatch === "partial"
  ) {
    return "partial";
  }
  if (verificationStatus.runtimeMatch === "extra-file-input-bug") {
    return "extra-file-input-bug";
  }
  return null;
}

export function getApiV1ResponseFromVerification(
  verification: Verification,
): ApiV1Response {
  const status = getMatchStatus(verification.status);
  let onchainCreationBytecode;
  try {
    onchainCreationBytecode = verification.onchainCreationBytecode;
  } catch (e) {
    // can be undefined
  }
  return {
    address: verification.address,
    chainId: verification.chainId.toString(),
    abiEncodedConstructorArguments:
      verification.transformations.creation.values.constructorArguments,
    libraryMap:
      verification.libraryMap.creation || verification.libraryMap.runtime,
    immutableReferences: verification.compilation.immutableReferences,
    runtimeTransformations: verification.transformations.runtime.list,
    creationTransformations: verification.transformations.creation.list,
    runtimeTransformationValues: verification.transformations.runtime.values,
    creationTransformationValues: verification.transformations.creation.values,
    onchainRuntimeBytecode: verification.onchainRuntimeBytecode,
    onchainCreationBytecode: onchainCreationBytecode,
    creatorTxHash: verification.deploymentInfo.txHash,
    blockNumber: verification.deploymentInfo.blockNumber,
    txIndex: verification.deploymentInfo.txIndex,
    deployer: verification.deploymentInfo.deployer,
    contractName: verification.compilation.compilationTarget.name,
    status,
  };
}

export function getApiV1ResponseFromMatch(match: Match): ApiV1Response {
  const status = getMatchStatus(match);
  return {
    address: match.address,
    chainId: match.chainId.toString(),
    onchainRuntimeBytecode: match.onchainRuntimeBytecode,
    contractName: match.contractName,
    storageTimestamp: match.storageTimestamp,
    status,
  };
}
