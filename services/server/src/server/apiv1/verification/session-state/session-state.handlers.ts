import { Response, Request } from "express";
import {
  FILE_ENCODING,
  addRemoteFile,
  checkContractsInSession,
  extractFiles,
  getSessionJSON,
  saveFilesToSession,
  verifyContractsInSession,
} from "../verification.common";
import {
  ISolidityCompiler,
  IVyperCompiler,
  PathBuffer,
  PathContent,
  performFetch,
  SolidityMetadataContract,
} from "@ethereum-sourcify/lib-sourcify";
import { BadRequestError } from "../../../../common/errors";

import { StatusCodes } from "http-status-codes";
import {
  AuxdataStyle,
  decode as bytecodeDecode,
} from "@ethereum-sourcify/bytecode-utils";
import logger from "../../../../common/logger";
import { Services } from "../../../services/services";
import { ChainRepository } from "../../../../sourcify-chain-repository";

export async function getSessionDataEndpoint(req: Request, res: Response) {
  res.send(getSessionJSON(req.session));
}

export async function addInputFilesEndpoint(req: Request, res: Response) {
  logger.debug("addInputFilesEndpoint");
  const services = req.app.get("services") as Services;
  const solc = req.app.get("solc") as ISolidityCompiler;
  const vyper = req.app.get("vyper") as IVyperCompiler;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;

  let inputFiles: PathBuffer[] | undefined;
  if (req.query.url) {
    inputFiles = await addRemoteFile(req.query);
  } else {
    inputFiles = extractFiles(req, true);
  }
  if (!inputFiles) throw new BadRequestError("No files found");
  const pathContents: PathContent[] = inputFiles.map((pb) => {
    return { path: pb.path, content: pb.buffer.toString(FILE_ENCODING) };
  });

  const dryRun = Boolean(req.query.dryrun);
  const session = req.session;
  const newFilesCount = saveFilesToSession(pathContents, session);
  if (newFilesCount) {
    await checkContractsInSession(session);
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
  }
  res.send(getSessionJSON(session));
}

export async function restartSessionEndpoint(req: Request, res: Response) {
  logger.debug("Restarting session", { sessionId: req.session.id });
  req.session.destroy((error: Error) => {
    let msg = "";
    let statusCode = null;

    if (error) {
      msg = "Error in clearing session";
      statusCode = StatusCodes.INTERNAL_SERVER_ERROR;
    } else {
      msg = "Session successfully cleared";
      statusCode = StatusCodes.OK;
    }

    res.status(statusCode).send(msg);
  });
}

export async function addInputContractEndpoint(req: Request, res: Response) {
  const address: string = req.body?.address;
  const chainId: string = req.body?.chainId;
  const solc = req.app.get("solc") as ISolidityCompiler;
  const vyper = req.app.get("vyper") as IVyperCompiler;
  const services = req.app.get("services") as Services;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;

  const sourcifyChain = chainRepository.sourcifyChainMap[chainId];

  const bytecode = await sourcifyChain.getBytecode(address);

  /**
   * We decode the bytecode using `AuxdataStyle.SOLIDITY` since Solidity is currently
   * the only smart contract language that includes metadata information in its bytecode.
   * This metadata contains an IPFS CID that points to a JSON file with the contract's
   * source code and compiler settings.
   */
  const { ipfs: metadataIpfsCid } = bytecodeDecode(
    bytecode,
    AuxdataStyle.SOLIDITY,
  );

  if (!metadataIpfsCid) {
    throw new BadRequestError("The contract doesn't have a metadata IPFS CID");
  }

  const ipfsGateway = SolidityMetadataContract.getGlobalIpfsGateway();
  const ipfsUrl = `${ipfsGateway.url}${metadataIpfsCid}`;
  const metadataFileName = "metadata.json";
  const retrievedMetadataText = await performFetch(
    ipfsUrl,
    undefined,
    undefined,
    ipfsGateway.headers,
  );

  if (!retrievedMetadataText) {
    logger.info("Could not retrieve metadata", { ipfsUrl });
    throw new Error(`Could not retrieve metadata from ${metadataIpfsCid}`);
  }
  const pathContents: PathContent[] = [];

  const retrievedMetadataBase64 = Buffer.from(retrievedMetadataText).toString(
    "base64",
  );

  pathContents.push({
    path: metadataFileName,
    content: retrievedMetadataBase64,
  });

  const session = req.session;

  const newFilesCount = saveFilesToSession(pathContents, session);
  if (newFilesCount) {
    await checkContractsInSession(session);
    // verifyValidated fetches missing files from the contract
    await verifyContractsInSession(
      solc,
      vyper,
      session.contractWrappers,
      session,
      services.verification,
      services.storage,
      chainRepository,
    );
  }
  res.send(getSessionJSON(session));
}
