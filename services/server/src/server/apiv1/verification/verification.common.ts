import { Request } from "express";
import { BadRequestError, PayloadTooLargeError } from "../../../common/errors";
import {
  InvalidSources,
  MissingSources,
  PathContent,
  IVyperCompiler,
  SolidityMetadataContract,
  VyperCompilation,
  CompilationTarget,
  Verification,
  VerificationError,
  useAllSourcesAndReturnCompilation,
  SolidityCompilation,
  unzipFiles,
  splitFiles,
  rearrangeSources,
} from "@ethereum-sourcify/lib-sourcify";
import { Session } from "express-session";
import { AbiConstructor, AbiParameter } from "abitype";
import QueryString from "qs";
import { VerificationService } from "../../services/VerificationService";
import {
  ContractMeta,
  ContractWrapper,
  ContractWrapperData,
} from "../../common";
import { ISolidityCompiler } from "@ethereum-sourcify/lib-sourcify";
import { StorageService } from "../../services/StorageService";
import logger from "../../../common/logger";
import { createHash } from "crypto";
import { ChainRepository } from "../../../sourcify-chain-repository";
import { Match } from "../../types";
import { keccak256 } from "ethers";
import { getMatchStatus } from "../controllers.common";

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

export const extractFilesFromJSON = (files: {
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

export const FILE_ENCODING = "base64";
export const MAX_SESSION_SIZE = 50 * 1024 * 1024; // 50 MiB

export function generateId(obj: any): string {
  const objString = JSON.stringify(obj);
  const hash = createHash("sha1").update(objString).digest("hex");
  return hash;
}

export const saveFilesToSession = (
  pathContents: PathContent[],
  session: Session,
): number => {
  if (!session.inputFiles) {
    session.inputFiles = {};
  }

  let inputSize = 0; // shall contain old buffer size + new files size
  for (const id in session.inputFiles) {
    const pc = session.inputFiles[id];
    inputSize += pc.content.length;
  }

  pathContents.forEach((pc) => (inputSize += pc.content.length));

  if (inputSize > MAX_SESSION_SIZE) {
    const msg =
      "Too much session memory used. Delete some files or clear the session.";
    throw new PayloadTooLargeError(msg);
  }

  let newFilesCount = 0;
  pathContents.forEach((pc) => {
    const newId = generateId(pc.content);
    if (!(newId in session.inputFiles)) {
      session.inputFiles[newId] = pc;
      ++newFilesCount;
    }
  });

  logger.info("Saved files to session", {
    newFilesCount,
    inputSize,
    sessionInputFilesLength: Object.keys(session.inputFiles).length,
    sessionId: session.id,
  });

  return newFilesCount;
};

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

// Contract object in the server response.
export type SendableContract = ContractMeta & {
  files: {
    found: string[];
    missing: MissingSources;
    invalid: InvalidSources;
  };
  verificationId: string;
  constructorArgumentsArray?: Mutable<AbiParameter[]>;
  // creationBytecode?: string; // Not needed without create2
};

function getSendableContract(
  contractWrapper: ContractWrapper,
  verificationId: string,
): SendableContract {
  const contract = contractWrapper.contract;

  return {
    verificationId,
    constructorArgumentsArray: (
      contract?.metadata?.output?.abi?.find(
        (abi) => abi.type === "constructor",
      ) as AbiConstructor
    )?.inputs as Mutable<AbiParameter[]>,
    // : contract?.creationBytecode, // Not needed without create2
    compiledPath: contract.compiledPath,
    name: contract.name,
    address: contractWrapper.address,
    chainId: contractWrapper.chainId,
    files: {
      found: Object.keys(contract.sources), // Source paths
      missing: contract.missing,
      invalid: contract.invalid,
    },
    status: contractWrapper.status || "error",
    statusMessage: contractWrapper.statusMessage,
    storageTimestamp: contractWrapper.storageTimestamp,
  };
}

export function getSessionJSON(session: Session) {
  const contractWrappers = session.contractWrappers || {};
  const contracts: SendableContract[] = [];
  for (const id in contractWrappers) {
    const sendableContract = getSendableContract(contractWrappers[id], id);
    contracts.push(sendableContract);
  }

  const files: string[] = [];
  for (const id in session.inputFiles) {
    files.push(session.inputFiles[id].path);
  }
  const unused = session.unusedSources || [];
  return { contracts, unused, files };
}

export interface ContractWrapperMap {
  [id: string]: ContractWrapper;
}

export function updateUnused(unused: string[], session: Session) {
  if (!session.unusedSources) {
    session.unusedSources = [];
  }
  session.unusedSources = unused;
}

/**
 * Extracts unused source files by comparing the input files with the used files.
 * @param inputFiles Array of source files
 * @param usedFiles Array of paths of used files
 * @param unused Array to be filled with unused file paths
 */
function extractUnused(
  inputFiles: PathContent[],
  usedFiles: string[],
): string[] {
  const unused: string[] = [];
  const usedFilesSet = new Set(usedFiles);
  const tmpUnused = inputFiles
    .map((pc) => pc.path)
    .filter((file) => !usedFilesSet.has(file));
  unused.push(...tmpUnused);
  return unused;
}

const createSessionContractsFromFiles = async (
  files: PathBuffer[],
): Promise<{
  contracts: ContractWrapperData[];
  unused: string[];
}> => {
  await unzipFiles(files);
  const parsedFiles: PathContent[] = files.map((pathBuffer) => ({
    content: pathBuffer.buffer.toString(),
    path: pathBuffer.path,
  }));
  const { metadataFiles, sourceFiles } = splitFiles(parsedFiles);

  const sessionContracts: ContractWrapperData[] = [];
  const usedFiles: string[] = [];

  for (const metadata of metadataFiles) {
    if (metadata.language === "Solidity") {
      const metadataContract = new SolidityMetadataContract(
        metadata,
        sourceFiles,
      );

      try {
        // Fetch missing sources
        await metadataContract.fetchMissing();
      } catch (e) {
        logger.error("Error fetching missing sources", { error: e });
      }

      sessionContracts.push({
        language: "Solidity",
        metadata: metadataContract.metadata,
        sources: metadataContract.foundSources,
        missing: metadataContract.missingSources,
        invalid: metadataContract.invalidSources,
        compiledPath: metadataContract.path,
        name: metadataContract.name,
      });

      // Track used files
      if (metadataContract.metadataPathToProvidedFilePath) {
        const currentUsedFiles = Object.values(
          metadataContract.metadataPathToProvidedFilePath,
        );
        usedFiles.push(...currentUsedFiles);
      }
    } else if (metadata.language === "Vyper") {
      const byHash: Map<string, PathContent> = new Map();
      for (const pathBuffer of files) {
        const calculatedHash = keccak256(pathBuffer.buffer);
        byHash.set(calculatedHash, {
          path: pathBuffer.path,
          content: pathBuffer.buffer.toString(),
        });
      }
      const { foundSources } = rearrangeSources(metadata, byHash);
      const compilationTarget = metadata.settings.compilationTarget;
      const contractPath = Object.keys(compilationTarget)[0];
      const contractName = compilationTarget[contractPath];
      sessionContracts.push({
        language: "Vyper",
        metadata: metadata,
        sources: foundSources,
        compiledPath: contractPath,
        name: contractName,
        missing: {},
        invalid: {},
      });
    } else {
      throw new Error("Unsupported language");
    }
  }

  // Track unused files
  const unused = extractUnused(sourceFiles, usedFiles);

  return { contracts: sessionContracts, unused };
};

export const checkContractsInSession = async (session: Session) => {
  const pathBuffers: PathBuffer[] = [];
  for (const id in session.inputFiles) {
    const pathContent = session.inputFiles[id];
    pathBuffers.push({
      path: pathContent.path,
      buffer: Buffer.from(pathContent.content, FILE_ENCODING),
    });
  }

  try {
    const contractsData = await createSessionContractsFromFiles(pathBuffers);

    const newPendingContracts: ContractWrapperMap = {};
    for (const contractData of contractsData.contracts) {
      newPendingContracts[
        generateId(JSON.stringify(JSON.stringify(contractData.metadata)))
      ] = {
        contract: contractData,
      };
    }

    session.contractWrappers ||= {};
    for (const newId in newPendingContracts) {
      const newContractWrapper = newPendingContracts[newId];
      const oldContractWrapper = session.contractWrappers[newId];
      if (oldContractWrapper) {
        for (const path in newContractWrapper.contract.sources) {
          oldContractWrapper.contract.sources[path] =
            newContractWrapper.contract.sources[path];
          delete oldContractWrapper.contract.missing[path];
        }
        oldContractWrapper.contract.sources =
          newContractWrapper.contract.sources;
        oldContractWrapper.contract.missing =
          newContractWrapper.contract.missing;
      } else {
        session.contractWrappers[newId] = newContractWrapper;
      }
    }
    updateUnused(contractsData.unused, session);
    logger.debug("Updated session", {
      sessionId: session.id,
      contracts: Object.keys(session.contractWrappers).map(
        (id) => session.contractWrappers[id].contract.name,
      ),
    });
  } catch (error) {
    const paths = pathBuffers.map((pb) => pb.path);
    updateUnused(paths, session);
  }
};

export async function addRemoteFile(
  query: QueryString.ParsedQs,
): Promise<PathBuffer[]> {
  logger.debug("addRemoteFile", { query });
  if (typeof query.url !== "string") {
    throw new BadRequestError("Query url must be a string");
  }
  let res;
  try {
    logger.debug("addRemoteFile Fetching", query.url);
    res = await fetch(query.url);
  } catch (err) {
    throw new BadRequestError("Couldn't fetch from " + query.url);
  }
  if (!res.ok) {
    logger.warn("addRemoteFile Failed Fetching", query.url, {
      status: res.status,
    });
    throw new BadRequestError("Couldn't fetch from " + query.url);
  }
  logger.debug("addRemoteFile Fetched", query.url, { status: res.status });
  // Save with the fileName exists on server response header.
  const fileName =
    res.headers.get("Content-Disposition")?.split("filename=")[1] ||
    query.url.substring(query.url.lastIndexOf("/") + 1) ||
    "file";
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return [
    {
      path: fileName,
      buffer,
    },
  ];
}

export const verifyContractsInSession = async (
  solc: ISolidityCompiler,
  vyper: IVyperCompiler,
  contractWrappers: ContractWrapperMap = {},
  session: Session,
  verificationService: VerificationService,
  storageService: StorageService,
  chainRepository: ChainRepository,
  dryRun: boolean = false,
): Promise<void> => {
  logger.debug("verifyContractsInSession", {
    sessionId: session.id,
    contracts: Object.keys(contractWrappers).map((id) => ({
      id,
      address: contractWrappers[id].address,
      chainId: contractWrappers[id].chainId,
    })),
  });
  for (const id in contractWrappers) {
    const contractWrapper = contractWrappers[id];

    logger.debug("verifyContractsInSession: iterate contract", {
      contractId: id,
      contract: contractWrapper.contract.name,
      address: contractWrapper.address,
      chainId: contractWrapper.chainId,
    });
    // Check if contract is already verified
    if (Boolean(contractWrapper.address) && Boolean(contractWrapper.chainId)) {
      const found = await isContractAlreadyPerfect(
        storageService,
        contractWrapper.address as string,
        contractWrapper.chainId as string,
      );

      if (found) {
        contractWrapper.status = found.runtimeMatch || "error";
        contractWrapper.statusMessage = found.message;
        contractWrapper.storageTimestamp = found.storageTimestamp;
        continue;
      }
    }

    const { address, chainId, contract, creatorTxHash } = contractWrapper;

    try {
      // Create compilation based on contract type
      let compilation;

      // Ensure required properties exist
      if (!contract.compiledPath || !contract.name) {
        throw new BadRequestError("Missing required contract information");
      }
      if (contract.language === "Solidity") {
        // Create SolidityMetadataContract
        const metadataContract = new SolidityMetadataContract(
          contract.metadata,
          Object.entries(contract.sources).map(([path, content]) => ({
            path,
            content: content,
          })) as PathContent[],
        );

        if (!metadataContract.isCompilable()) {
          logger.debug("verifyContractsInSession: not verifiable", {
            contractId: id,
          });
          continue;
        }

        // Create compilation
        compilation = await metadataContract.createCompilation(solc);
      } else if (contract.language === "Vyper") {
        // Extract compiler version from metadata
        const compilerVersion = contract.metadata.compiler.version;
        if (!compilerVersion) {
          throw new BadRequestError("Missing compiler version in metadata");
        }

        // Extract compilation target from metadata
        const compilationTarget = contract.metadata.settings.compilationTarget;
        const contractPath = Object.keys(compilationTarget)[0];
        const contractName = compilationTarget[contractPath];

        // Create compilation target
        const target: CompilationTarget = {
          path: contractPath,
          name: contractName,
        };

        // Extract settings from metadata
        const compilationSettings = JSON.parse(
          JSON.stringify(contract.metadata.settings),
        );
        delete compilationSettings.compilationTarget;

        // Create VyperJsonInput with required outputSelection
        const vyperJsonInput = {
          language: "Vyper" as const,
          sources: Object.fromEntries(
            Object.entries(contract.sources).map(([path, content]) => [
              path,
              { content },
            ]),
          ),
          settings: {
            ...compilationSettings,
            outputSelection: {},
          },
        };

        // Create compilation
        compilation = new VyperCompilation(
          vyper,
          compilerVersion,
          vyperJsonInput,
          target,
        );
      } else {
        throw new BadRequestError(`Unsupported language: ${contract.language}`);
      }

      // Verify the contract using the new verification flow
      let verification: Verification;

      try {
        verification = await verificationService.verifyFromCompilation(
          compilation,
          chainRepository.sourcifyChainMap[chainId as string],
          address as string,
          creatorTxHash,
        );
      } catch (error: any) {
        // If the compilation is not a SolidityCompilation, log and rethrow
        // If the error is not a VerificationError, log and rethrow
        // If the error is not an extra_file_input_bug, log and rethrow
        if (
          !(compilation instanceof SolidityCompilation) ||
          !(error instanceof VerificationError) ||
          error.code !== "extra_file_input_bug"
        ) {
          logger.error("Verification error", { error });
          throw error;
        }

        logger.debug(
          "verifyContractsInSession: extra-file-input-bug encountered",
          {
            contractId: id,
          },
        );
        const pathBufferInputFiles: PathBuffer[] = Object.values(
          session.inputFiles,
        ).map((base64file) => ({
          path: base64file.path,
          buffer: Buffer.from(base64file.content, FILE_ENCODING),
        }));

        const compilationWithAllSources =
          await useAllSourcesAndReturnCompilation(
            compilation,
            pathBufferInputFiles,
          );
        verification = await verificationService.verifyFromCompilation(
          compilationWithAllSources,
          chainRepository.sourcifyChainMap[chainId as string],
          address as string,
          creatorTxHash,
        );
      }

      // Store the verification result
      if (!dryRun) {
        await storageService.storeVerification(verification.export());
      }

      // Update contract wrapper with verification result
      contractWrapper.status = getMatchStatus(verification.status);
      contractWrapper.statusMessage = ""; // We don't have access to a message property
    } catch (error: any) {
      logger.warn("Error verifying contract in session", {
        error: error.message,
        sessionId: session.id,
        contractId: id,
      });

      contractWrapper.status = "error";
      contractWrapper.statusMessage = error.message;
    }
  }
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
