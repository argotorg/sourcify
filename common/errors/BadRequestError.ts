import { StatusCodes } from "http-status-codes";
import { IResponseError } from "../interfaces";

export class BadRequestError implements IResponseError {
  statusCode: number;
  message: string;

  constructor(message?: string) {
    this.statusCode = StatusCodes.BAD_REQUEST;
    this.message = message || "Bad request";
  }
}
