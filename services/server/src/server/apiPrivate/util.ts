import type { Request, Response, NextFunction } from "express";
import { getAddress } from "ethers";
import { BadRequestError, InternalServerError } from "../../common/errors";
import logger from "../../common/logger";
import type { Services } from "../services/services";
import type { StorageService } from "../services/StorageService";
import { getMatchStatus } from "../services/utils/util";
import type {
  ImmutableReferences,
  StringMap,
  Transformation,
  TransformationValues,
  Verification,
  VerificationStatus,
} from "@ethereum-sourcify/lib-sourcify";
import type { Match } from "../types";

export const VERIFY_ENDPOINTS_DEPRECATION_WARNING =
  "DEPRECATED: This endpoint will be removed. Do not build new integrations against it. " +
  "Use POST /v2/verify instead. " +
  "Full API docs: https://sourcify.dev/server/api-docs/swagger.json";

type PathBuffer = {
  path: string;
  buffer: Buffer;
};

export type LegacyVerifyRequest = Request & {
  body: {
    addresses: string[];
    chain: string;
    chosenContract: number;
  };
};

export function checksumAddresses(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    // stateless
    if (req.body?.address) {
      req.body.address = getAddress(req.body.address);
    }
    if (req.query.addresses) {
      req.query.addresses = (req.query.addresses as string)
        .split(",")
        .map((address: string) => getAddress(address))
        .join(",");
    }
  } catch (err: any) {
    throw new BadRequestError(`Invalid address: ${err.message}`);
  }
  next();
}

export const extractFiles = (req: Request, shouldThrow = false) => {
  if (req.is("multipart/form-data") && (req.files as any)?.files) {
    return extractFilesFromForm((req.files as any).files);
  } else if (req.is("application/json") && req.body?.files) {
    return extractFilesFromJSON(req.body.files);
  }

  if (shouldThrow) {
    throw new BadRequestError("There should be files in the <files> field");
  }
  return undefined;
};

const extractFilesFromForm = (files: any): PathBuffer[] => {
  if (!Array.isArray(files)) {
    files = [files];
  }
  logger.debug("extractFilesFromForm", {
    files: files.map((f: any) => f.name),
  });
  return files.map((f: any) => ({ path: f.name, buffer: f.data }));
};

const extractFilesFromJSON = (files: {
  [key: string]: string;
}): PathBuffer[] => {
  logger.debug("extractFilesFromJSON", { files: Object.keys(files) });
  const inputFiles: PathBuffer[] = [];
  for (const name in files) {
    const file = files[name];
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
    inputFiles.push({ path: name, buffer });
  }
  return inputFiles;
};

export async function isContractAlreadyPerfect(
  storageService: StorageService,
  address: string,
  chainId: string,
): Promise<Match | false> {
  const result = await storageService.performServiceOperation(
    "checkByChainAndAddress",
    [address, chainId],
  );
  if (
    result.length != 0 &&
    result[0].runtimeMatch === "perfect" &&
    result[0].creationMatch === "perfect"
  ) {
    return result[0];
  } else {
    return false;
  }
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

export interface ApiV1Response extends Omit<
  Match,
  "runtimeMatch" | "creationMatch"
> {
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
  warning?: string;
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
    warning: VERIFY_ENDPOINTS_DEPRECATION_WARNING,
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
    warning: VERIFY_ENDPOINTS_DEPRECATION_WARNING,
  };
}
