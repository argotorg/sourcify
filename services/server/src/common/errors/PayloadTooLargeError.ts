import { StatusCodes } from "http-status-codes";
import { IResponseError } from "../interfaces";

export class PayloadTooLargeError implements IResponseError {
  statusCode: number;
  message: string;

  constructor(message?: string) {
    this.statusCode = StatusCodes.REQUEST_TOO_LONG;
    this.message = message || "Payload too large";
  }
}
