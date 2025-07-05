import { StatusCodes } from "http-status-codes";
import { IResponseError } from "../interfaces";

export class TooManyRequests implements IResponseError {
  statusCode: number;
  message: string;

  constructor(message?: string) {
    this.statusCode = StatusCodes.TOO_MANY_REQUESTS;
    this.message = message || "Too Many Requests";
  }
}
