import { StatusCodes } from "http-status-codes";
import { IResponseError } from "../interfaces";

export class NotFoundError implements IResponseError {
  statusCode: number;
  message: string;

  constructor(message?: string) {
    this.statusCode = StatusCodes.NOT_FOUND;
    this.message = message || "Resouce not found";
  }
}
