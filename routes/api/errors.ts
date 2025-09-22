import {
  BadRequestError,
  NotFoundError,
  InternalServerError,
  ConflictError,
} from "../../common/errors";
import { v4 as uuidv4 } from "uuid";
import type { Request, Response, NextFunction } from "express";
import { error as openApiValidatorErrors } from "express-openapi-validator";
import {
  getErrorMessageFromCode,
  SourcifyLibErrorCode,
  SourcifyLibErrorParameters,
} from "@ethereum-sourcify/lib-sourcify";
import { TooManyRequests } from "../../common/errors/TooManyRequests";
import { BadGatewayError } from "../../common/errors/BadGatewayError";

export type ErrorCode =
  | VerificationErrorCode
  | "internal_error"
  | "route_not_found"
  | "unsupported_chain"
  | "invalid_parameter"
  | "proxy_resolution_error"
  | "job_not_found"
  | "duplicate_verification_request"
  | "confluxscan_request_failed"
  | "confluxscan_limit"
  | "not_confluxscan_verified"
  | "malformed_confluxscan_response";

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

export class ConfluxscanRequestFailedError extends BadGatewayError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "confluxscan_request_failed",
      message,
      errorId: uuidv4(),
    };
  }
}

export class ConfluxscanLimitError extends TooManyRequests {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "confluxscan_limit",
      message,
      errorId: uuidv4(),
    };
  }
}

export class NotConfluxscanVerifiedError extends NotFoundError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "not_confluxscan_verified",
      message,
      errorId: uuidv4(),
    };
  }
}

export class MalformedConfluxscanResponseError extends BadRequestError {
  payload: GenericErrorResponse;

  constructor(message: string) {
    super(message);
    this.payload = {
      customCode: "malformed_confluxscan_response",
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

  if (
    err instanceof openApiValidatorErrors.BadRequest ||
    err instanceof openApiValidatorErrors.RequestEntityTooLarge ||
    err instanceof openApiValidatorErrors.UnsupportedMediaType
  ) {
    next(new InvalidParametersError(err.message));
    return;
  }

  console.error("API v2 internal error: ", { error: err });
  next(new InternalError("The server encountered an unexpected error."));
}

export type VerificationErrorCode =
  | SourcifyLibErrorCode
  | "unsupported_language"
  | "already_verified"
  | "internal_error"
  | "no_similar_match_found";

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

export function getChainId(chainId: string): number {
  const chain = Number(chainId);
  if (Number.isNaN(chain)) {
    throw new InvalidParametersError(`Invalid chainId ${chainId}`);
  }
  return chain;
}
