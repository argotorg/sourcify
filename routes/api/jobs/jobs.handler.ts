import { StatusCodes } from "http-status-codes";
import { Services } from "../../../services/services";
import { Request } from "express";
import { TypedResponse, VerificationJob } from "../../types";
import { JobNotFoundError } from "../errors";

interface GetJobRequest extends Request {
  params: {
    verificationId: string;
  };
}

type GetJobResponse = TypedResponse<VerificationJob>;

export async function getJobEndpoint(req: GetJobRequest, res: GetJobResponse) {
  console.debug("getJobEndpoint", {
    verificationId: req.params.verificationId,
  });
  const services = req.app.get("services") as Services;

  const job = await services.store.getVerificationJob(req.params.verificationId)
  if (!job) {
    throw new JobNotFoundError(
      `No verification job found for id ${req.params.verificationId}`,
    );
  }

  res.status(StatusCodes.OK).json(job);
}
