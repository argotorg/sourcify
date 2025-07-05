import { Response, Request } from "express";
import {
  fetchFromEtherscan,
  getCompilationFromEtherscanResult,
} from "../../../../services/utils/etherscan-util";
import logger from "../../../../../common/logger";
import { ChainRepository } from "../../../../../sourcify-chain-repository";
import {
  ISolidityCompiler,
  IVyperCompiler,
} from "@ethereum-sourcify/lib-sourcify";
import { Services } from "../../../../services/services";
import { getApiV1ResponseFromVerification } from "../../../controllers.common";

export async function verifyFromEtherscan(req: Request, res: Response) {
  const services = req.app.get("services") as Services;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;
  chainRepository.checkSupportedChainId(req.body?.chain);

  const solc = req.app.get("solc") as ISolidityCompiler;
  const vyperCompiler = req.app.get("vyper") as IVyperCompiler;

  const chain = req.body?.chain as string;
  const address = req.body?.address;
  const apiKey = req.body?.apiKey;
  const sourcifyChain = chainRepository.supportedChainMap[chain];

  logger.info("verifyFromEtherscan", { chain, address, apiKey });

  const etherscanResult = await fetchFromEtherscan(
    sourcifyChain,
    address,
    apiKey,
  );

  const compilation = await getCompilationFromEtherscanResult(
    etherscanResult,
    solc,
    vyperCompiler,
  );

  // Verify the contract using the new verification flow
  const verification = await services.verification.verifyFromCompilation(
    compilation,
    sourcifyChain,
    address,
  );

  // Store the verification result
  await services.storage.storeVerification(verification.export());

  // Return the verification result
  res.send({ result: [getApiV1ResponseFromVerification(verification)] });
}
