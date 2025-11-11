import { StatusCodes } from "http-status-codes";
import type { Services } from "../../services/services";
import logger from "../../../common/logger";
import type { Request } from "express";
import type { TypedResponse, VerificationJob } from "../../types";
import { JobNotFoundError } from "../errors";
import { createGetEtherscanVerifyApiServiceApiUrl } from "../../services/storageServices/EtherscanVerifyApiService";

interface GetJobRequest extends Request {
  params: {
    verificationId: string;
  };
}

type GetJobResponse = TypedResponse<VerificationJob>;

export async function getJobEndpoint(req: GetJobRequest, res: GetJobResponse) {
  logger.debug("getJobEndpoint", {
    verificationId: req.params.verificationId,
  });
  const services = req.app.get("services") as Services;

  const job = await services.storage.performServiceOperation(
    "getVerificationJob",
    [
      req.params.verificationId,
      createGetEtherscanVerifyApiServiceApiUrl(services.storage),
    ],
  );

  if (!job) {
    throw new JobNotFoundError(
      `No verification job found for id ${req.params.verificationId}`,
    );
  }

  res.status(StatusCodes.OK).json(job);
}
