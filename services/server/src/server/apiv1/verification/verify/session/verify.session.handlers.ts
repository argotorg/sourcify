import { Response, Request } from "express";
import {
  SendableContract,
  getSessionJSON,
  verifyContractsInSession,
} from "../../verification.common";
import {
  isEmpty,
  ISolidityCompiler,
  IVyperCompiler,
} from "@ethereum-sourcify/lib-sourcify";
import { BadRequestError } from "../../../../../common/errors";
import logger from "../../../../../common/logger";
import { Services } from "../../../../services/services";
import { ChainRepository } from "../../../../../sourcify-chain-repository";

export async function verifyContractsInSessionEndpoint(
  req: Request,
  res: Response,
) {
  const services = req.app.get("services") as Services;
  const solc = req.app.get("solc") as ISolidityCompiler;
  const vyper = req.app.get("vyper") as IVyperCompiler;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;

  const session = req.session;
  if (!session.contractWrappers || isEmpty(session.contractWrappers)) {
    throw new BadRequestError("There are currently no pending contracts.");
  }

  const dryRun = Boolean(req.query.dryrun);

  const receivedContracts: SendableContract[] = req.body?.contracts;

  /* eslint-disable indent */
  logger.info("verifyContractsInSession", {
    receivedContracts: receivedContracts.map(
      ({ verificationId, chainId, address }) => ({
        verificationId,
        chainId,
        address,
      }),
    ),
  });

  for (const receivedContract of receivedContracts) {
    const id = receivedContract.verificationId;
    const contractWrapper = session.contractWrappers[id];
    if (contractWrapper) {
      contractWrapper.address = receivedContract.address;
      contractWrapper.chainId = receivedContract.chainId;
      contractWrapper.creatorTxHash = receivedContract.creatorTxHash;
    }
  }

  await verifyContractsInSession(
    solc,
    vyper,
    session.contractWrappers,
    session,
    services.verification,
    services.storage,
    chainRepository,
    dryRun,
  );
  res.send(getSessionJSON(session));
}
