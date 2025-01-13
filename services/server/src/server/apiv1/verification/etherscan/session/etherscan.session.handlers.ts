import { Response, Request } from "express";
import {
  ContractWrapperMap,
  checkContractsInSession,
  getSessionJSON,
  isVerifiable,
  saveFilesToSession,
  verifyContractsInSession,
} from "../../verification.common";
import {
  ISolidityCompiler,
  IVyperCompiler,
  PathContent,
  Sources,
} from "@ethereum-sourcify/lib-sourcify";
import { BadRequestError } from "../../../../../common/errors";
import {
  processEtherscanSolidityContract,
  processEtherscanVyperContract,
  processRequestFromEtherscan,
  stringToBase64,
} from "../etherscan.common";
import logger from "../../../../../common/logger";
import { ChainRepository } from "../../../../../sourcify-chain-repository";
import { Services } from "../../../../services/services";

export async function sessionVerifyFromEtherscan(req: Request, res: Response) {
  const services = req.app.get("services") as Services;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;
  const solc = req.app.get("solc") as ISolidityCompiler;
  const vyper = req.app.get("vyper") as IVyperCompiler;

  logger.info("sessionVerifyFromEtherscan", {
    chainId: req.body.chain,
    address: req.body.address,
  });

  chainRepository.checkSupportedChainId(req.body.chain);

  const chain = req.body.chain;
  const address = req.body.address;
  const apiKey = req.body.apiKey;
  const sourcifyChain = chainRepository.supportedChainMap[chain];

  const { vyperResult, solidityResult } = await processRequestFromEtherscan(
    sourcifyChain,
    address,
    apiKey,
  );

  let checkedContract;
  let sources: Sources;
  if (solidityResult) {
    checkedContract = await processEtherscanSolidityContract(
      solc,
      solidityResult.compilerVersion,
      solidityResult.solcJsonInput,
      solidityResult.contractName,
    );
    sources = solidityResult.solcJsonInput.sources;
  } else if (vyperResult) {
    checkedContract = await processEtherscanVyperContract(
      vyper,
      vyperResult.compilerVersion,
      vyperResult.vyperJsonInput,
      vyperResult.contractPath,
      vyperResult.contractName,
    );
    sources = vyperResult.vyperJsonInput.sources;
  } else {
    logger.error("Import from Etherscan: unsupported language");
    throw new BadRequestError("Received unsupported language from Etherscan");
  }

  const pathContents: PathContent[] = Object.keys(sources).map((path) => {
    if (!sources[path].content) {
      throw new BadRequestError(
        `The contract doesn't have a content for the path ${path}`,
      );
    }
    return {
      path: path,
      content: stringToBase64(sources[path].content),
    };
  });
  pathContents.push({
    path: "metadata.json",
    content: stringToBase64(JSON.stringify(checkedContract.metadata)),
  });
  const session = req.session;
  const newFilesCount = saveFilesToSession(pathContents, session);
  if (newFilesCount === 0) {
    throw new BadRequestError("The contract didn't add any new file");
  }

  await checkContractsInSession(solc, vyper, session);
  if (!session.contractWrappers) {
    throw new BadRequestError(
      "Unknown error during the Etherscan verification process",
    );
    return;
  }

  const verifiable: ContractWrapperMap = {};
  for (const id of Object.keys(session.contractWrappers)) {
    const contractWrapper = session.contractWrappers[id];
    if (contractWrapper) {
      if (!contractWrapper.address) {
        contractWrapper.address = address;
        contractWrapper.chainId = chain;
      }
      if (isVerifiable(contractWrapper)) {
        verifiable[id] = contractWrapper;
      }
    }
  }

  await verifyContractsInSession(
    solc,
    vyper,
    verifiable,
    session,
    services.verification,
    services.storage,
    chainRepository,
  );
  res.send(getSessionJSON(session));
}
