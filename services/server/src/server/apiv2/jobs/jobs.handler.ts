import { StatusCodes } from "http-status-codes";
import type { Services } from "../../services/services";
import logger from "../../../common/logger";
import type { Request } from "express";
import type { TypedResponse, VerificationJob } from "../../types";
import { JobNotFoundError } from "../errors";
import { buildJobExternalVerificationsObject } from "../../services/storageServices/EtherscanVerifyApiService";

interface GetJobRequest extends Request {
  params: {
    verificationId: string;
  };
}

type GetJobResponse = TypedResponse<VerificationJob<"api">>;

export async function getJobEndpoint(req: GetJobRequest, res: GetJobResponse) {
  logger.debug("getJobEndpoint", {
    verificationId: req.params.verificationId,
  });
  const services = req.app.get("services") as Services;

  const job = await services.storage.performServiceOperation(
    "getVerificationJob",
    [req.params.verificationId],
  );

  if (!job) {
    throw new JobNotFoundError(
      `No verification job found for id ${req.params.verificationId}`,
    );
  }

  // If the job contains external verifications and the EtherscanVerify services are enabled,
  // add to the response the urls to get the verification status on external verifiers
  const externalVerifications = job.externalVerifications
    ? buildJobExternalVerificationsObject(
        services.storage,
        job.externalVerifications,
        job.contract.chainId,
        job.verificationId,
      )
    : undefined;

  const transformedJob: VerificationJob<"api"> = {
    ...job,
    externalVerifications,
  };

  res.status(StatusCodes.OK).json(transformedJob);
}
