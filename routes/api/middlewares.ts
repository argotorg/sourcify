import { Request, Response, NextFunction } from "express";
import {
  AlreadyVerifiedError,
  ChainNotFoundError,
  DuplicateVerificationRequestError, getChainId,
  InvalidParametersError as InvalidParameterError,
  InvalidParametersError
} from "./errors";
import { getAddress } from "ethers";
import { FIELDS_TO_STORED_PROPERTIES } from "../../services/store/Tables";
import { reduceAccessorStringToProperty } from "../../services/utils/util";
import { Services } from "../../services/services";
import type { Metadata, SolidityJsonInput, VyperJsonInput} from "@ethereum-sourcify/lib-sourcify";
import { ChainMap } from "../../server";

export function validateChainId(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const chainMap = req.app.get("chains") as ChainMap
  const keys = new Set(Object.keys(chainMap))
  if(!keys.has(req.params.chainId) || !chainMap[req.params.chainId]) {
    console.info("Invalid chainId in params", {
      params: req.params,
    });
    throw new ChainNotFoundError(`Chain ${req.params.chainId} not found`);
  }
  next();
}

export function validateAddress(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // Checksum the address
    req.params.address = getAddress(req.params.address);
  } catch (err: any) {
    console.info("Invalid address in params", {
      errorMessage: err.message,
      errorStack: err.stack,
      params: req.params,
    });
    throw new InvalidParameterError(`Invalid address: ${req.params.address}`);
  }

  next();
}

export function validateFieldsAndOmit(
  req: Request & { query: { fields?: string; omit?: string } },
  res: Response,
  next: NextFunction,
) {
  if (req.query.fields && req.query.omit) {
    throw new InvalidParametersError("Cannot specify both fields and omit");
  }

  const fields = req.query.fields?.split(",");
  const omits = req.query.omit?.split(",");

  const validateField = (fullField: string) => {
    const splitField = fullField.split(".");
    if (splitField.length > 2) {
      throw new InvalidParametersError(
        `Field selector cannot have more than one level subselectors: ${fullField}`,
      );
    }

    try {
      reduceAccessorStringToProperty(fullField, FIELDS_TO_STORED_PROPERTIES);
    } catch (error) {
      throw new InvalidParametersError(
        `Field selector ${fullField} is not a valid field`,
      );
    }
  };

  if (fields?.includes("all")) {
    if (fields.length > 1) {
      throw new InvalidParametersError(
        "Cannot specify 'all' with other fields",
      );
    }
    // If all is requested, overwrite the requested fields with all existing ones
    req.query.fields = Object.keys(FIELDS_TO_STORED_PROPERTIES).join(",");
  } else {
    fields?.forEach(validateField);
  }

  omits?.forEach(validateField);

  next();
}

export function validateStandardJsonInput(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.body.stdJsonInput) {
    throw new InvalidParametersError("Standard JSON input is required.");
  }

  const stdJsonInput = req.body.stdJsonInput as
    | SolidityJsonInput
    | VyperJsonInput;
  if (!stdJsonInput.language) {
    throw new InvalidParametersError(
      "Standard JSON input must contain a language field.",
    );
  }
  if (!stdJsonInput.sources) {
    throw new InvalidParametersError(
      "Standard JSON input must contain a sources field.",
    );
  }
  if (Object.values(stdJsonInput.sources).some((source) => !source['content'])) {
    throw new InvalidParametersError(
      "Standard JSON input must contain a content field for each source.",
    );
  }

  next();
}

export function validateContractIdentifier(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.body.contractIdentifier) {
    throw new InvalidParametersError("Contract identifier is required");
  }

  const splitIdentifier = req.body.contractIdentifier.split(":");
  if (splitIdentifier.length < 2) {
    throw new InvalidParametersError(
      "The contractIdentifier must consist of the file path and the contract name separated by a ':'.",
    );
  }

  next();
}

export function validateCompilerVersion(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.body.compilerVersion) {
    throw new InvalidParametersError("Compiler version is required");
  }

  next();
}

export function validateMetadata(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.body.metadata) {
    throw new InvalidParametersError("Metadata is required.");
  }

  const metadata = req.body.metadata as Metadata;
  if (!metadata.compiler) {
    throw new InvalidParametersError("Metadata must contain a compiler field.");
  }
  if (!metadata.compiler.version) {
    throw new InvalidParametersError(
      "Metadata must contain a compiler.version field.",
    );
  }
  if (!metadata.language) {
    throw new InvalidParametersError("Metadata must contain a language field.");
  }
  if (!metadata.settings) {
    throw new InvalidParametersError("Metadata must contain a settings field.");
  }
  if (!metadata.settings.compilationTarget) {
    throw new InvalidParametersError(
      "Metadata must contain a settings.compilationTarget field.",
    );
  }
  if (!metadata.sources) {
    throw new InvalidParametersError("Metadata must contain a sources field.");
  }

  next();
}

export async function checkIfAlreadyVerified(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { address, chainId } = req.params;
  const chain = getChainId(chainId)
  const services = req.app.get("services") as Services;
  const contract = await services.store.getContract(chain, address)
  if (
    contract.runtimeMatch === "exact_match" &&
    contract.creationMatch === "exact_match"
  ) {
    throw new AlreadyVerifiedError(
      `Contract ${address} on chain ${chainId} is already verified with runtimeMatch and creationMatch both being exact matches.`,
    );
  }

  next();
}

export async function checkIfJobIsAlreadyRunning(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { address, chainId } = req.params;
  const chain = getChainId(chainId)
  const services = req.app.get("services") as Services;
  const jobs = await services.store.getVerificationJobsByChainAndAddress(chain, address)
  if (jobs.length > 0 &&
    jobs.some(job => (!job.isJobCompleted) && services.verification.isRunning(job.verificationId))) {
    console.warn("Contract already being verified", { chainId, address });
    throw new DuplicateVerificationRequestError(
      `Contract ${address} on chain ${chainId} is already being verified`,
    );
  }

  next();
}
