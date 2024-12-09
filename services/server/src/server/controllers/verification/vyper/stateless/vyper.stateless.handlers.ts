import { Response, Request } from "express";
import { extractFiles } from "../../verification.common";
import {
  VyperCheckedContract,
  IVyperCompiler,
  StringMap,
} from "@ethereum-sourcify/lib-sourcify";
import { NotFoundError } from "../../../../../common/errors";
import { getResponseMatchFromMatch } from "../../../../common";
import { Services } from "../../../../services/services";
import { ChainRepository } from "../../../../../sourcify-chain-repository";

export type VerifyVyperRequest = Request & {
  body: {
    files: Record<string, string>;
    compilerVersion: string;
    compilerSettings: string;
    contractPath: string;
    contractName: string;
  };
};

export async function verifyVyper(
  req: VerifyVyperRequest,
  res: Response,
): Promise<any> {
  const services = req.app.get("services") as Services;
  const vyperCompiler = req.app.get("vyper") as IVyperCompiler;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;

  const inputFiles = extractFiles(req);
  if (!inputFiles) {
    const msg =
      "Couldn't extract files from the request. Please make sure you have added files";
    throw new NotFoundError(msg);
  }

  const compilerVersion = req.body.compilerVersion; // "0.8.4+commit.c7e474f2";
  const compilerSettings = req.body.compilerSettings;

  const contractPath = req.body.contractPath;
  const contractName = req.body.contractName;

  const sources = inputFiles.reduce((acc, file) => {
    acc[file.path] = file.buffer.toString();
    return acc;
  }, {} as StringMap);

  const checkedContract = new VyperCheckedContract(
    vyperCompiler,
    compilerVersion,
    contractPath,
    contractName,
    compilerSettings,
    sources,
  );

  /* if (!contract) {
    throw new NotFoundError(
      "Chosen contract not found. Received chosenContract: " +
        req.body.chosenContract,
    );
  } */

  const match = await services.verification.verifyDeployed(
    checkedContract,
    chainRepository.sourcifyChainMap[req.body.chain],
    req.body.address,
    req.body.creatorTxHash,
  );
  if (match.runtimeMatch || match.creationMatch) {
    await services.storage.storeMatch(checkedContract, match);
  }
  return res.send({ result: [getResponseMatchFromMatch(match)] }); // array is an old expected behavior (e.g. by frontend)
}
