import {
  BadRequestError,
  NotFoundError,
  InternalServerError,
  ConflictError,
} from "../../common/errors";
import { v4 as uuidv4 } from "uuid";
import type { Request, Response, NextFunction } from "express";
import { error as openApiValidatorErrors } from "express-openapi-validator";
import logger from "../../common/logger";
import {
  getErrorMessageFromCode,
  SourcifyLibErrorCode,
  SourcifyLibErrorParameters,
} from "@ethereum-sourcify/lib-sourcify";
import { TooManyRequests } from "../../common/errors/TooManyRequests";
import { BadGatewayError } from "../../common/errors/BadGatewayError";
import { JobErrorData } from "../services/utils/database-util";

export type ErrorCode =
  | VerificationErrorCode
  | "internal_error"
  | "route_not_found"
  | "unsupported_chain"
  | "invalid_parameter"
  | "invalid_json"
  | "proxy_resolution_error"
  | "job_not_found"
  | "duplicate_verification_request"
  | "etherscan_request_failed"
  | "etherscan_limit"
  | "not_etherscan_verified"
  | "malformed_etherscan_response";

export interface GenericErrorResponse {
  customCode: ErrorCode;
  message: string;
  errorId: string;
}

export interface MatchingErrorResponse extends GenericErrorResponse {
  customCode: VerificationErrorCode;
  recompiledCreationCode?: string;
  recompiledRuntimeCode?: string;
  onchainCreationCode?: string;
  onchainRuntimeCode?: string;
  creationTransactionHash?: string;
  errorData?: JobErrorData;
}

export class InternalError extends InternalServerError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "internal_error",
      message,
      errorId: uuidv4(),
    };
  }
}

export class RouteNotFoundError extends NotFoundError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "route_not_found",
      message,
      errorId: uuidv4(),
    };
  }
}

export class ChainNotFoundError extends NotFoundError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "unsupported_chain",
      message,
      errorId: uuidv4(),
    };
  }
}

export class InvalidParametersError extends BadRequestError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "invalid_parameter",
      message,
      errorId: uuidv4(),
    };
  }
}

export class JobNotFoundError extends NotFoundError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "job_not_found",
      message,
      errorId: uuidv4(),
    };
  }
}

export class DuplicateVerificationRequestError extends TooManyRequests {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "duplicate_verification_request",
      message,
      errorId: uuidv4(),
    };
  }
}

export class AlreadyVerifiedError extends ConflictError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "already_verified",
      message,
      errorId: uuidv4(),
    };
  }
}

export class EtherscanRequestFailedError extends BadGatewayError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "etherscan_request_failed",
      message,
      errorId: uuidv4(),
    };
  }
}

export class EtherscanLimitError extends TooManyRequests {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "etherscan_limit",
      message,
      errorId: uuidv4(),
    };
  }
}

export class NotEtherscanVerifiedError extends NotFoundError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "not_etherscan_verified",
      message,
      errorId: uuidv4(),
    };
  }
}

export class MalformedEtherscanResponseError extends BadRequestError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "malformed_etherscan_response",
      message,
      errorId: uuidv4(),
    };
  }
}

export class InvalidJsonError extends BadRequestError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "invalid_json",
      message,
      errorId: uuidv4(),
    };
  }
}

// Maps OpenApiValidator errors to our custom error format
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Let errors pass that already match the v2 error format
  if (err.payload) {
    next(err);
    return;
  }

  if (err instanceof SyntaxError) {
    next(new InvalidJsonError(err.message));
    return;
  }

  if (
    err instanceof openApiValidatorErrors.BadRequest ||
    err instanceof openApiValidatorErrors.RequestEntityTooLarge ||
    err instanceof openApiValidatorErrors.UnsupportedMediaType
  ) {
    next(new InvalidParametersError(err.message));
    return;
  }

  logger.error("API v2 internal error: ", { error: err });
  next(new InternalError("The server encountered an unexpected error."));
}

export type VerificationErrorCode =
  | SourcifyLibErrorCode
  | "unsupported_language"
  | "already_verified"
  | "internal_error";

export type VerificationErrorParameters =
  | SourcifyLibErrorParameters
  | {
      code: VerificationErrorCode;
    };

export function getVerificationErrorMessage(
  params: VerificationErrorParameters,
) {
  switch (params.code) {
    case "unsupported_language":
      return "The provided language is not supported.";
    case "already_verified":
      return "The contract is already verified and the job didn't yield a better match.";
    case "internal_error":
      return "The server encountered an unexpected error.";
    default:
      return getErrorMessageFromCode(params as SourcifyLibErrorParameters);
  }
}
