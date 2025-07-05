import { Response } from "express";
import { LegacyVerifyRequest, extractFiles } from "../../verification.common";
import {
  ISolidityCompiler,
  SolidityMetadataContract,
  createMetadataContractsFromFiles,
  Verification,
  SolidityCompilation,
  SolidityJsonInput,
  Metadata,
} from "@ethereum-sourcify/lib-sourcify";
import { BadRequestError, NotFoundError } from "../../../../../common/errors";
import { StatusCodes } from "http-status-codes";
import { Services } from "../../../../services/services";
import { ChainRepository } from "../../../../../sourcify-chain-repository";
import logger from "../../../../../common/logger";
import { getApiV1ResponseFromVerification } from "../../../controllers.common";

export async function verifyDeprecated(
  req: LegacyVerifyRequest,
  res: Response,
): Promise<any> {
  const solc = req.app.get("solc") as ISolidityCompiler;
  const services = req.app.get("services") as Services;
  const chainRepository = req.app.get("chainRepository") as ChainRepository;

  const inputFiles = extractFiles(req);
  if (!inputFiles) {
    const msg =
      "Couldn't extract files from the request. Please make sure you have added files";
    throw new NotFoundError(msg);
  }

  let metadataContracts: SolidityMetadataContract[];
  try {
    metadataContracts = await createMetadataContractsFromFiles(inputFiles);
  } catch (error: any) {
    throw new BadRequestError(error.message);
  }

  if (metadataContracts.length !== 1 && !req.body?.chosenContract) {
    const contractNames = metadataContracts.map((c) => c.name).join(", ");
    const msg = `Detected ${metadataContracts.length} contracts (${contractNames}), but can only verify 1 at a time. Please choose a main contract and click Verify again.`;
    const contractsToChoose = metadataContracts.map((contract) => ({
      name: contract.name,
      path: contract.path,
    }));
    return res
      .status(StatusCodes.BAD_REQUEST)
      .send({ error: msg, contractsToChoose });
  }

  const contract: SolidityMetadataContract = req.body?.chosenContract
    ? metadataContracts[req.body?.chosenContract]
    : metadataContracts[0];

  if (!contract) {
    throw new NotFoundError(
      "Chosen contract not found. Received chosenContract: " +
        req.body?.chosenContract,
    );
  }

  // Fetch missing files
  try {
    await contract.fetchMissing();
  } catch (error: any) {
    logger.debug("Error fetching missing files", {
      error: error,
    });
  }

  const stringifyInvalidAndMissing = (contract: SolidityMetadataContract) => {
    const errors = Object.keys(contract.invalidSources).concat(
      Object.keys(contract.missingSources),
    );
    return `${contract.name} (${errors.join(", ")})`;
  };

  if (!contract.isCompilable()) {
    throw new BadRequestError(
      "Invalid or missing sources in:\n" + stringifyInvalidAndMissing(contract),
    );
  }

  try {
    // Create a compilation from the contract and compile it
    const compilation = await contract.createCompilation(solc);

    // We need to compile the compilation before creating the Verification object
    // because we are not going to call verify() on the Verification object
    await compilation.compile();
    // We don't expect `generateCborAuxdataPositions` to throw an error, so let's throw it if it does
    // We don't need to log a specific error here because this function is not called by users
    await compilation.generateCborAuxdataPositions();

    // Create a mock Verification object for deprecated chains
    const verification = new Verification(
      compilation,
      chainRepository.sourcifyChainMap[req.body.chain],
      req.body.address,
      req.body.creatorTxHash,
    );

    // Override verification properties for deprecated chains
    // The hexadecimal string is '!!!!!!!!! - chain was deprecated at the time of verification'
    const deprecatedMessage =
      "0x2121212121212121212121202d20636861696e207761732064657072656361746564206174207468652074696d65206f6620766572696669636174696f6e";

    // Set status based on request match type
    (verification as any).runtimeMatch = req.body.match;
    (verification as any).creationMatch = req.body.match;

    // Set mock bytecodes
    (verification as any)._onchainRuntimeBytecode = deprecatedMessage;
    (verification as any)._onchainCreationBytecode = deprecatedMessage;

    // Set deployment info
    (verification as any).blockNumber = -1;
    (verification as any).creatorTxHash = undefined; // null bytea
    (verification as any).txIndex = -1;
    (verification as any).deployer = undefined; // null bytea

    // Store the verification
    await services.storage.storeVerification(verification.export());

    res.send({
      result: [getApiV1ResponseFromVerification(verification)],
    });
  } catch (error: any) {
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .send({ error: error.message });
  }
}

/**
 * This function is used to fix the creation information (match, transformations list, transformations values, metadata match) of contract with misaligned creation data.
 *
 * We beging by mocking both the compilation and the sourcifyChain information with data from the database, so that recompilation and rpc calls are not performed.
 * Then we verify the contract again with the new mocked compilation and sourcifyChain objects.
 * Finally we upgrade the misaligned contract by UPDATING the verified_contracts and sourcify_matches creation fields.
 */
export async function upgradeContract(
  req: LegacyVerifyRequest,
  res: Response,
): Promise<any> {
  const sourcifyMatchId = req.body.sourcifyMatchId;
  if (!sourcifyMatchId) {
    return res
      .status(StatusCodes.BAD_REQUEST)
      .send({ error: "sourcifyMatchId is required" });
  }

  const solc = req.app.get("solc") as ISolidityCompiler;
  const services = req.app.get("services") as Services;

  // Get the connection pool from storage service to fetch data
  const sourcifyDatabaseService =
    services.storage.rwServices["SourcifyDatabase"];

  if (!sourcifyDatabaseService) {
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .send({ error: "Database service not available" });
  }

  // Access the pool via the sourcifyDatabaseService
  const poolClient = await (
    sourcifyDatabaseService as any
  ).database.pool.connect();

  try {
    // Fetch compilation data from the database
    const verifiedContractResult = await poolClient.query(
      `SELECT 
        verified_contracts.*,
        sourcify_matches.metadata,
        compiled_contracts.compiler,
        compiled_contracts.version,
        compiled_contracts.language,
        compiled_contracts.name,
        compiled_contracts.fully_qualified_name,
        compiled_contracts.compiler_settings,
        compiled_contracts.compilation_artifacts,
        compiled_contracts.creation_code_artifacts,
        compiled_contracts.runtime_code_artifacts,
        compiled_creation_code.code as compiled_creation_code,
        compiled_runtime_code.code as compiled_runtime_code,
        contract_deployments.address,
        contract_deployments.chain_id,
        contract_deployments.transaction_hash,
        contract_deployments.block_number,
        contract_deployments.transaction_index,
        encode(contract_deployments.deployer, 'hex') as deployer,
        onchain_creation_code.code as onchain_creation_code,
        onchain_runtime_code.code as onchain_runtime_code
      FROM verified_contracts
      JOIN compiled_contracts ON compiled_contracts.id = verified_contracts.compilation_id
      JOIN sourcify_matches ON sourcify_matches.verified_contract_id = verified_contracts.id
      JOIN code compiled_creation_code ON compiled_contracts.creation_code_hash = compiled_creation_code.code_hash 
      JOIN code compiled_runtime_code ON compiled_contracts.runtime_code_hash = compiled_runtime_code.code_hash
      JOIN contract_deployments ON contract_deployments.id = verified_contracts.deployment_id
      JOIN contracts ON contracts.id = contract_deployments.contract_id
      JOIN code onchain_creation_code ON onchain_creation_code.code_hash = contracts.creation_code_hash
      JOIN code onchain_runtime_code ON onchain_runtime_code.code_hash = contracts.runtime_code_hash
      WHERE sourcify_matches.id = $1`,
      [sourcifyMatchId],
    );

    if (verifiedContractResult.rows.length === 0) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .send({ error: "Verified contract not found" });
    }

    const verifiedContract = verifiedContractResult.rows[0];

    // Fetch sources
    const sourcesResult = await poolClient.query(
      `SELECT 
        sources.content,
        compiled_contracts_sources.path
      FROM compiled_contracts_sources
      JOIN sources ON sources.source_hash = compiled_contracts_sources.source_hash
      WHERE compiled_contracts_sources.compilation_id = $1`,
      [verifiedContract.compilation_id],
    );

    // Initialize jsonInput with data from database
    const compilerVersion = verifiedContract.version;

    // Create sources object from the query result
    const sources: Record<string, { content: string }> = {};
    for (const source of sourcesResult.rows) {
      sources[source.path] = { content: source.content };
    }

    // Create settings from compiler_settings JSON field
    const settings = verifiedContract.compiler_settings;

    // Initialize jsonInput with the required fields
    const jsonInput: SolidityJsonInput = {
      language: "Solidity",
      sources: sources,
      settings: settings,
    };

    // Get the file path and contract name from fully_qualified_name
    const metadataCompilationTarget = (verifiedContract.metadata as Metadata)
      .settings.compilationTarget;
    const compilationTarget = {
      name: Object.values(metadataCompilationTarget)[0],
      path: Object.keys(metadataCompilationTarget)[0],
    };

    const compilationArtifacts = verifiedContract.compilation_artifacts;

    const creationCodeArtifacts = verifiedContract.creation_code_artifacts;

    const runtimeCodeArtifacts = verifiedContract.runtime_code_artifacts;

    const compilation = new SolidityCompilation(
      solc,
      compilerVersion,
      jsonInput,
      compilationTarget,
    );

    compilation.compilerOutput = {
      sources: compilationArtifacts.sources,
      contracts: {
        [compilationTarget.path]: {
          [compilationTarget.name]: {
            abi: compilationArtifacts.abi,
            userdoc: compilationArtifacts.userdoc,
            devdoc: compilationArtifacts.devdoc,
            metadata: verifiedContract.metadata,
            storageLayout: compilationArtifacts.storageLayout,
            evm: {
              bytecode: {
                object: verifiedContract.compiled_creation_code.toString("hex"),
                sourceMap: creationCodeArtifacts.sourceMap,
                linkReferences: creationCodeArtifacts.linkReferences,
              },
              deployedBytecode: {
                object: verifiedContract.compiled_runtime_code.toString("hex"),
                sourceMap: runtimeCodeArtifacts.sourceMap,
                linkReferences: runtimeCodeArtifacts.linkReferences,
                immutableReferences: runtimeCodeArtifacts.immutableReferences,
              },
            },
          },
        },
      },
    };

    compilation["compile"] = async () => {
      // Override so that it doesn't compile
    };

    compilation["generateCborAuxdataPositions"] = async () => {
      // Override so that it doesn't generate auxdata positions
    };

    Object.defineProperty(compilation, "metadata", {
      value: verifiedContract.metadata,
    });

    Object.defineProperty(compilation, "creationBytecodeCborAuxdata", {
      value: creationCodeArtifacts.cborAuxdata,
    });

    Object.defineProperty(compilation, "runtimeBytecodeCborAuxdata", {
      value: runtimeCodeArtifacts.cborAuxdata,
    });

    const sourcifyChainMock = {
      getBytecode: async (address: string) => {
        return `0x${verifiedContract.onchain_runtime_code.toString("hex")}`;
      },
      getTx: async (txHash: string) => {
        return {
          blockNumber: verifiedContract.block_number,
          from: `0x${verifiedContract.deployer.toString("hex")}`,
        };
      },
      getContractCreationBytecodeAndReceipt: async (address: string) => {
        return {
          creationBytecode: `0x${verifiedContract.onchain_creation_code.toString("hex")}`,
          txReceipt: {
            index: verifiedContract.transaction_index,
          },
        };
      },
      chainId: verifiedContract.chain_id,
    };

    const verification = new Verification(
      compilation,
      sourcifyChainMock as any,
      `0x${verifiedContract.address.toString("hex")}`,
      `0x${verifiedContract.transaction_hash.toString("hex")}`,
    );

    await verification.verify();

    // Get the verification status
    const verificationStatus = verification.status;
    const creationMatch =
      verificationStatus.creationMatch === "perfect" ||
      verificationStatus.creationMatch === "partial";

    let creationTransformations = null;
    let creationValues = null;
    let creationMetadataMatch = null;
    if (creationMatch) {
      creationTransformations = verification.transformations.creation.list
        ? JSON.stringify(verification.transformations.creation.list)
        : [];
      creationValues = verification.transformations.creation.values
        ? JSON.stringify(verification.transformations.creation.values)
        : {};
      creationMetadataMatch = verification.status.creationMatch === "perfect";
    }

    // Begin transaction for database updates
    await poolClient.query("BEGIN");

    // 1. Update verified_contracts table using direct query
    await poolClient.query(
      `UPDATE verified_contracts SET 
        creation_match = $1,
        creation_transformations = $2,
        creation_values = $3,
        creation_metadata_match = $4
      WHERE id = $5`,
      [
        creationMatch,
        creationTransformations,
        creationValues,
        creationMetadataMatch,
        verifiedContract.id,
      ],
    );

    // 2. Update sourcify_matches table using direct query instead of updateSourcifyMatch
    await poolClient.query(
      `UPDATE sourcify_matches SET 
        creation_match = $1
      WHERE id = $2`,
      [verificationStatus.creationMatch, sourcifyMatchId],
    );

    // Commit the transaction
    await poolClient.query("COMMIT");

    res.send({
      result: {
        message: "Contract upgrade successful",
        verifiedContractId: verifiedContract.id,
        sourcifyMatchId: sourcifyMatchId,
      },
    });
  } catch (error: any) {
    // Rollback in case of error
    if (poolClient) {
      await poolClient.query("ROLLBACK");
    }
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .send({ error: error.message });
  } finally {
    // Release the client back to the pool
    if (poolClient) {
      poolClient.release();
    }
  }
}
