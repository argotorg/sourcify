import { Response, Request } from "express";
import { extractFiles } from "../../verification.common";
import {
  ISolidityCompiler,
  SolidityMetadataContract,
  createMetadataContractsFromFiles,
} from "@ethereum-sourcify/lib-sourcify";
import { BadRequestError } from "../../../../../common/errors";
import { Services } from "../../../../services/services";
import { ChainRepository } from "../../../../../sourcify-chain-repository";
import { getApiV1ResponseFromVerification } from "../../../controllers.common";

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

  let solcJson;
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

  // Get metadata and sources from the Solidity JSON input
  const metadataAndSourcesPathBuffers =
    await services.verification.getAllMetadataAndSourcesFromSolcJson(
      solc,
      solcJson,
      compilerVersion,
    );

  // Create metadata contracts from the files
  const metadataContracts = await createMetadataContractsFromFiles(
    metadataAndSourcesPathBuffers,
  );

  // Find the contract to verify
  const contractToVerify = metadataContracts.find(
    (c: SolidityMetadataContract) => c.name === contractName,
  );

  if (!contractToVerify) {
    throw new BadRequestError(
      `Couldn't find contract ${contractName} in the provided Solidity JSON Input file.`,
    );
  }

  // Create compilation from the metadata contract
  const compilation = await contractToVerify.createCompilation(solc);

  // Verify the contract using the new verification flow
  const verification = await services.verification.verifyFromCompilation(
    compilation,
    chainRepository.sourcifyChainMap[chain],
    address,
    req.body?.creatorTxHash,
  );

  // Store the verification result
  await services.storage.storeVerification(verification.export());

  // Return the verification result
  res.send({ result: [getApiV1ResponseFromVerification(verification)] }); // array is an old expected behavior (e.g. by frontend)
}
