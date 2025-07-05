import { StatusCodes } from "http-status-codes";
import { IResponseError } from "../interfaces";

export class BadGatewayError implements IResponseError {
  statusCode: number;
  message: string;

  constructor(message?: string) {
    this.statusCode = StatusCodes.BAD_GATEWAY;
    this.message = message || "Bad gateway";
  }
}
