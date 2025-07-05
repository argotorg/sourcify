import { StatusCodes } from "http-status-codes";
import { IResponseError } from "../interfaces";

export class InternalServerError implements IResponseError {
  statusCode: number;
  message: string;

  constructor(message?: string) {
    this.statusCode = StatusCodes.INTERNAL_SERVER_ERROR;
    this.message = message || "Something went wrong";
  }
}
