import { StatusCodes } from "http-status-codes";
import { IResponseError } from "../interfaces";

export class ContractIsAlreadyBeingVerifiedError implements IResponseError {
  statusCode: number;
  message: string;

  constructor(chainId: string, address: string) {
    this.statusCode = StatusCodes.TOO_MANY_REQUESTS;
    this.message = `The contract ${address} on chainId ${chainId} is already being verified, please wait`;
  }
}
