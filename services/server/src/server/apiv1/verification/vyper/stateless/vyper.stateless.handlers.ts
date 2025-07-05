import { Response, Request } from "express";
import { extractFiles } from "../../verification.common";
import {
  IVyperCompiler,
  StringMap,
  VyperSettings,
  VyperCompilation,
  VyperJsonInput,
} from "@ethereum-sourcify/lib-sourcify";
import { NotFoundError, BadRequestError } from "../../../../../common/errors";
import { Services } from "../../../../services/services";
import { ChainRepository } from "../../../../../sourcify-chain-repository";
import logger from "../../../../../common/logger";
import { getApiV1ResponseFromVerification } from "../../../controllers.common";

export type VerifyVyperRequest = Omit<Request, "body"> & {
  body: {
    files: Record<string, string>;
    compilerVersion: string;
    compilerSettings: VyperSettings;
    contractPath: string;
    contractName: string;
    address: string;
    creatorTxHash: string;
    chain: string;
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
  if (!inputFiles || !inputFiles.length) {
    const msg =
      "Couldn't extract files from the request. Please make sure you have added files";
    throw new NotFoundError(msg);
  }

  let compilation: VyperCompilation;
  try {
    const sources = inputFiles.reduce((files, file) => {
      files[file.path] = file.buffer.toString();
      return files;
    }, {} as StringMap);

    // Create VyperJsonInput
    const vyperJsonInput: VyperJsonInput = {
      language: "Vyper",
      sources: Object.fromEntries(
        Object.entries(sources).map(([path, content]) => [path, { content }]),
      ),
      settings: req.body.compilerSettings,
    };

    // Create compilation target
    const compilationTarget = {
      path: req.body.contractPath,
      name: req.body.contractName,
    };

    // Create VyperCompilation
    compilation = new VyperCompilation(
      vyperCompiler,
      req.body?.compilerVersion,
      vyperJsonInput,
      compilationTarget,
    );
  } catch (error: any) {
    logger.warn("Error initializing Vyper compiler input", {
      error: error,
    });
    throw new BadRequestError(
      "Error initializing Vyper compiler input, please check files and settings",
    );
  }

  // Verify using the new verification flow
  const verification = await services.verification.verifyFromCompilation(
    compilation,
    chainRepository.sourcifyChainMap[req.body.chain],
    req.body?.address,
    req.body?.creatorTxHash,
  );

  // Store verification result
  await services.storage.storeVerification(verification.export());

  // Return the result
  res.send({
    result: [getApiV1ResponseFromVerification(verification)],
  });
}
