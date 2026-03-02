import type { Request } from "express";
import { BadRequestError } from "../../../common/errors";
import type { StorageService } from "../../services/StorageService";
import logger from "../../../common/logger";
import type { Match } from "../../types";

type PathBuffer = {
  path: string;
  buffer: Buffer;
};

export type LegacyVerifyRequest = Request & {
  body: {
    addresses: string[];
    chain: string;
    chosenContract: number;
  };
};

export const extractFiles = (req: Request, shouldThrow = false) => {
  if (req.is("multipart/form-data") && (req.files as any)?.files) {
    return extractFilesFromForm((req.files as any).files);
  } else if (req.is("application/json") && req.body?.files) {
    return extractFilesFromJSON(req.body.files);
  }

  if (shouldThrow) {
    throw new BadRequestError("There should be files in the <files> field");
  }
};

const extractFilesFromForm = (files: any): PathBuffer[] => {
  if (!Array.isArray(files)) {
    files = [files];
  }
  logger.debug("extractFilesFromForm", {
    files: files.map((f: any) => f.name),
  });
  return files.map((f: any) => ({ path: f.name, buffer: f.data }));
};

const extractFilesFromJSON = (files: {
  [key: string]: string;
}): PathBuffer[] => {
  logger.debug("extractFilesFromJSON", { files: Object.keys(files) });
  const inputFiles: PathBuffer[] = [];
  for (const name in files) {
    const file = files[name];
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
    inputFiles.push({ path: name, buffer });
  }
  return inputFiles;
};

export async function isContractAlreadyPerfect(
  storageService: StorageService,
  address: string,
  chainId: string,
): Promise<Match | false> {
  const result = await storageService.performServiceOperation(
    "checkByChainAndAddress",
    [address, chainId],
  );
  if (
    result.length != 0 &&
    result[0].runtimeMatch === "perfect" &&
    result[0].creationMatch === "perfect"
  ) {
    return result[0];
  } else {
    return false;
  }
}
