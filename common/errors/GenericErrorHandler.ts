import { getReasonPhrase, StatusCodes } from "http-status-codes";
import { Request, Response } from "express";

export default function genericErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  // Next function is required for Express to recognize this as an error handler. Error handlers must have 4 parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: any,
): void {
  try {
    const errorCode =
      +err.statusCode || err.status || StatusCodes.INTERNAL_SERVER_ERROR;
    if (errorCode === StatusCodes.INTERNAL_SERVER_ERROR) {
      console.error(`Unexpected server error: ${err.message}`, { error: err });
    }

    if (err.payload) {
      // APIv2 errors include the response payload
      res.status(errorCode).json(err.payload);
      return;
    }
    if (err.errors) {
      // This is a validation error
      res.status(errorCode).json({
        message: err.message,
        errors: err.errors,
      });
      return;
    }
    res.status(errorCode).json({
      error: err.message || getReasonPhrase(errorCode), // Need to keep this for backward compatibility, but ideally we should respond with `message` only
      message: err.message || getReasonPhrase(errorCode),
    });
  } catch (error) {
    console.error("Error in genericErrorHandler", { error });
    const errorCode = StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(errorCode).json({
      error: err.message || getReasonPhrase(errorCode),
      message: err.message || getReasonPhrase(errorCode),
    });
  }
}
