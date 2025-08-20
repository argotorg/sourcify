import { Response, Request } from "express";
import { extractFiles } from "../../verification.common";
import {
  ISolidityCompiler,
  SolidityCompilation,
  SolidityJsonInput,
} from "@ethereum-sourcify/lib-sourcify";
import { BadRequestError } from "../../../../../common/errors";
import { Services } from "../../../../services/services";
import { ChainRepository } from "../../../../../sourcify-chain-repository";
import { getApiV1ResponseFromVerification } from "../../../controllers.common";
import logger from "../../../../../common/logger";
import { getContractPathFromSources } from "../../../../services/utils/parsing-util";

export async function verifySolcJsonEndpoint(req: Request, res: Response) {
  const services = req.app.get("services") as Services;
  const solc = req.app.get("solc") as ISolidityCompiler;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;

  const inputFiles = extractFiles(req, true);
  if (!inputFiles) throw new BadRequestError("No files found");
  if (inputFiles.length !== 1)
    throw new BadRequestError(
      "Only one Solidity JSON Input file at a time is allowed",
    );

  let solcJson: SolidityJsonInput;
  try {
    solcJson = JSON.parse(inputFiles[0].buffer.toString());
  } catch (error: any) {
    throw new BadRequestError(
      `Couldn't parse JSON ${inputFiles[0].path}. Make sure the contents of the file are syntaxed correctly.`,
    );
  }
  const compilerVersion = req.body?.compilerVersion;
  const contractName = req.body?.contractName;
  const chain = req.body?.chain;
  const address = req.body?.address;
  const creatorTxHash = req.body?.creatorTxHash;

  logger.debug("Request to /verify/solc-json", {
    chainId: chain,
    address: address,
    contractName: contractName,
    compilerVersion: compilerVersion,
    creatorTxHash: creatorTxHash,
  });

  const contractPath = getContractPathFromSources(
    contractName,
    solcJson.sources,
  );
  if (!contractPath) {
    throw new BadRequestError(
      `Couldn't find contract ${contractName} in the provided Solidity JSON Input file.`,
    );
  }

  const compilation = new SolidityCompilation(solc, compilerVersion, solcJson, {
    name: contractName,
    path: contractPath,
  });

  // Verify the contract using the new verification flow
  const verification = await services.verification.verifyFromCompilation(
    compilation,
    chainRepository.sourcifyChainMap[chain],
    address,
    creatorTxHash,
  );

  // Store the verification result
  await services.storage.storeVerification(verification.export());

  // Return the verification result
  res.send({ result: [getApiV1ResponseFromVerification(verification)] }); // array is an old expected behavior (e.g. by frontend)
}
