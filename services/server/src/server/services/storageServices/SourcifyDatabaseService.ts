import type {
  VerificationStatus,
  VerificationExport,
  ISolidityCompiler,
  IVyperCompiler,
  IFeCompiler,
  PreRunCompilation,
} from "@ethereum-sourcify/lib-sourcify";
import logger from "../../../common/logger";
import AbstractDatabaseService from "./AbstractDatabaseService";
import type { RWStorageService } from "../StorageService";
import type {
  Field,
  GetSourcifyMatchByChainAddressWithPropertiesResult,
  StoredProperties,
  Tables,
} from "../utils/database-util";
import {
  bytesFromString,
  normalizeCallProtection,
  FIELDS_TO_STORED_PROPERTIES,
  createPreRunCompilationFromStoredCandidate,
} from "../utils/database-util";
import type {
  VerifiedContractMinimal,
  VerifiedContract,
  VerificationJob,
  Match,
  VerificationJobId,
  BytesKeccak,
  SimilarityCandidate,
} from "../../types";
import {
  getTotalMatchLevel,
  reduceAccessorStringToProperty,
  toMatchLevel,
} from "../utils/util";
import { getAddress } from "ethers";
import { extractSignaturesFromAbi } from "../utils/signature-util";
import { ConflictError } from "../../../common/errors";
import { RWStorageIdentifiers } from "./identifiers";
import type { DatabaseOptions } from "../utils/Database";
import type { VerificationErrorCode } from "../../apiv2/errors";
import { getVerificationErrorMessage } from "../../apiv2/errors";
import type { VerifyErrorExport } from "../workers/workerTypes";
import type { PoolClient } from "pg";

export class SourcifyDatabaseService
  extends AbstractDatabaseService
  implements RWStorageService
{
  serverUrl: string;
  IDENTIFIER = RWStorageIdentifiers.SourcifyDatabase;

  constructor(options: DatabaseOptions, serverUrl: string) {
    super(options);
    this.serverUrl = serverUrl;
  }

  async checkByChainAndAddress(
    address: string,
    chainId: string,
  ): Promise<Match[]> {
    return this.checkByChainAndAddressAndMatch(address, chainId, true);
  }

  async checkAllByChainAndAddress(
    address: string,
    chainId: string,
  ): Promise<Match[]> {
    return this.checkByChainAndAddressAndMatch(address, chainId, false);
  }

  async checkByChainAndAddressAndMatch(
    address: string,
    chainId: string,
    onlyPerfectMatches: boolean = false,
  ): Promise<Match[]> {
    await this.init();

    const existingVerifiedContractResult =
      await this.database.getSourcifyMatchByChainAddress(
        parseInt(chainId),
        bytesFromString(address)!,
        onlyPerfectMatches,
      );

    if (existingVerifiedContractResult.rowCount === 0) {
      return [];
    }
    return [
      {
        address,
        chainId,
        runtimeMatch: existingVerifiedContractResult.rows[0]
          .runtime_match as VerificationStatus,
        creationMatch: existingVerifiedContractResult.rows[0]
          .creation_match as VerificationStatus,
        storageTimestamp: existingVerifiedContractResult.rows[0].created_at,
        onchainRuntimeBytecode:
          existingVerifiedContractResult.rows[0].onchain_runtime_code,
        contractName: existingVerifiedContractResult.rows[0].name,
      },
    ];
  }

  validateVerificationBeforeStoring(verification: VerificationExport): boolean {
    if (
      verification.status.runtimeMatch === null &&
      verification.status.creationMatch === null
    ) {
      throw new Error(
        `can only store contracts with at least runtimeMatch or creationMatch. address=${verification.address} chainId=${verification.chainId}`,
      );
    }
    if (
      verification.compilation.runtimeBytecode === undefined &&
      verification.compilation.creationBytecode === undefined
    ) {
      throw new Error(
        `can only store contracts with at least runtimeBytecode or creationBytecode. address=${verification.address} chainId=${verification.chainId}`,
      );
    }
    return true;
  }

  ////////////////////////
  // APIv2 related methods
  ////////////////////////

  getContractsByChainId = async (
    chainId: string,
    limit: number,
    descending: boolean,
    afterMatchId?: string,
  ): Promise<{ results: VerifiedContractMinimal[] }> => {
    await this.init();

    const sourcifyMatchesResult = await this.database.getSourcifyMatchesByChain(
      parseInt(chainId),
      limit,
      descending,
      afterMatchId,
    );

    const results: VerifiedContractMinimal[] = sourcifyMatchesResult.rows.map(
      (row) => ({
        match: getTotalMatchLevel(row.creation_match, row.runtime_match),
        creationMatch: toMatchLevel(row.creation_match),
        runtimeMatch: toMatchLevel(row.runtime_match),
        chainId,
        address: getAddress(row.address),
        verifiedAt: row.verified_at,
        matchId: row.id,
      }),
    );

    return { results };
  };

  getContract = async (
    chainId: string,
    address: string,
    fields?: Field[],
    omit?: Field[],
  ): Promise<VerifiedContract> => {
    if (fields && omit) {
      throw new Error("Cannot specify both fields and omit at the same time");
    }

    // Collect which fields are requested
    const requestedFields = new Set<Field>();

    if (fields) {
      fields.forEach((field) => requestedFields.add(field));
    }

    if (omit) {
      for (const field of Object.keys(FIELDS_TO_STORED_PROPERTIES)) {
        if (typeof field === "string") {
          if (!omit.includes(field as Field)) {
            requestedFields.add(field as Field);
          }
        } else {
          for (const subField of Object.keys(field)) {
            const fullSubField: Field = `${field}.${subField}`;
            if (!omit.includes(field) && !omit.includes(fullSubField)) {
              requestedFields.add(fullSubField);
            }
          }
        }
      }
    }

    // Add default fields
    const defaultFields: Field[] = [
      "matchId",
      "creationMatch",
      "runtimeMatch",
      "verifiedAt",
    ];
    defaultFields.forEach((field) => requestedFields.add(field));

    // Get corresponding database properties
    const requestedProperties = Array.from(requestedFields).reduce(
      (properties, fullField) => {
        const property = reduceAccessorStringToProperty(
          fullField,
          FIELDS_TO_STORED_PROPERTIES,
        );

        if (typeof property === "string") {
          properties.push(property as StoredProperties);
        } else {
          // The whole subobject is requested, e.g. the creationBytecode object
          for (const value of Object.values(property)) {
            properties.push(value);
          }
        }
        return properties;
      },
      [] as StoredProperties[],
    );

    // Fetch language when metadata is requested — only Solidity has metadata
    const metadataRequested = requestedFields.has("metadata");
    if (metadataRequested && !requestedProperties.includes("language")) {
      requestedProperties.push("language");
    }

    // Retrieve database result
    const sourcifyMatchResult =
      await this.database.getSourcifyMatchByChainAddressWithProperties(
        parseInt(chainId),
        bytesFromString(address),
        requestedProperties,
      );

    if (sourcifyMatchResult.rowCount === 0) {
      logger.debug("No sourcify match found for contract", {
        chainId,
        address,
      });
      return {
        match: null,
        creationMatch: null,
        runtimeMatch: null,
        chainId,
        address,
      };
    }

    // Map the database result to the contract object
    const retrievedContract = Array.from(requestedFields).reduce(
      (verifiedContract, fullField) => {
        const property = reduceAccessorStringToProperty(
          fullField,
          FIELDS_TO_STORED_PROPERTIES,
        );

        const addToContract = (field: string, subField: string, value: any) => {
          if (subField) {
            if (!verifiedContract[field]) {
              verifiedContract[field] = {};
            }
            verifiedContract[field][subField] = value;
          } else {
            verifiedContract[field] = value;
          }
        };

        if (typeof property === "string") {
          const [field, subField] = fullField.split(".");
          addToContract(
            field,
            subField,
            sourcifyMatchResult.rows[0][property as StoredProperties],
          );
        } else {
          // The whole subobject is requested, e.g. the creationBytecode object
          for (const [subfield, subproperty] of Object.entries(property)) {
            addToContract(
              fullField,
              subfield,
              sourcifyMatchResult.rows[0][subproperty as StoredProperties],
            );
          }
        }
        return verifiedContract;
      },
      {} as any,
    );

    // Add and transform the properties of the contract which cannot be handled on the db level
    const result: VerifiedContract = {
      ...retrievedContract,
      match: getTotalMatchLevel(
        retrievedContract.creationMatch,
        retrievedContract.runtimeMatch,
      ),
      creationMatch: toMatchLevel(retrievedContract.creationMatch),
      runtimeMatch: toMatchLevel(retrievedContract.runtimeMatch),
      chainId,
      address,
    };

    if (retrievedContract.deployment?.deployer) {
      result.deployment!.deployer = getAddress(
        retrievedContract.deployment.deployer,
      );
    }

    // Only Solidity contracts have metadata.
    if (metadataRequested) {
      const language = sourcifyMatchResult.rows[0].language;
      if (language?.toLowerCase() !== "solidity") {
        result.metadata = null;
      }
    }

    return result;
  };

  getContractsAllChains = async (
    address: string,
  ): Promise<{ results: VerifiedContractMinimal[] }> => {
    const result = await this.database.getSourcifyMatchesAllChains(
      bytesFromString(address),
    );

    const results: VerifiedContractMinimal[] = result.rows.map((row) => ({
      match: getTotalMatchLevel(row.creation_match, row.runtime_match),
      creationMatch: toMatchLevel(row.creation_match),
      runtimeMatch: toMatchLevel(row.runtime_match),
      matchId: row.id,
      chainId: row.chain_id,
      address: getAddress(row.address),
      verifiedAt: row.verified_at,
    }));

    return { results };
  };

  getVerificationJob = async (
    verificationId: string,
  ): Promise<VerificationJob<"raw"> | null> => {
    const result = await this.database.getVerificationJobById(verificationId);

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];

    // Still using old match naming for compatibility with utility functions
    const creationMatch = row.creation_match
      ? row.creation_metadata_match
        ? "perfect"
        : "partial"
      : null;
    const runtimeMatch = row.runtime_match
      ? row.runtime_metadata_match
        ? "perfect"
        : "partial"
      : null;

    const address = getAddress(row.contract_address);
    const job: VerificationJob<"raw"> = {
      isJobCompleted: !!row.completed_at,
      verificationId,
      jobStartTime: row.started_at,
      jobFinishTime: row.completed_at || undefined,
      compilationTime: row.compilation_time || undefined,
      externalVerifications: row.external_verification,
      contract: {
        match: getTotalMatchLevel(creationMatch, runtimeMatch),
        creationMatch: toMatchLevel(creationMatch),
        runtimeMatch: toMatchLevel(runtimeMatch),
        chainId: row.chain_id,
        address,
        verifiedAt: row.verified_at || undefined,
        matchId: row.match_id || undefined,
      },
    };

    if (row.error_code && row.error_id) {
      job.error = {
        customCode: row.error_code as VerificationErrorCode,
        message: getVerificationErrorMessage({
          code: row.error_code as VerificationErrorCode,
          chainId: row.chain_id,
          address,
          ...row.error_data,
        }),
        errorId: row.error_id,
        recompiledCreationCode: row.recompiled_creation_code || undefined,
        recompiledRuntimeCode: row.recompiled_runtime_code || undefined,
        onchainCreationCode: row.onchain_creation_code || undefined,
        onchainRuntimeCode: row.onchain_runtime_code || undefined,
        creationTransactionHash: row.creation_transaction_hash || undefined,
        errorData: row.error_data || undefined,
      };
    }

    return job;
  };

  getVerificationJobsByChainAndAddress = async (
    chainId: string,
    address: string,
  ): Promise<Pick<VerificationJob, "isJobCompleted">[]> => {
    const result = await this.database.getVerificationJobsByChainAndAddress(
      chainId,
      bytesFromString(address),
    );
    return result.rows.map((row) => ({
      isJobCompleted: !!row.completed_at,
    }));
  };

  async storeVerificationJob(
    startTime: Date,
    chainId: string,
    address: string,
    verificationEndpoint: string,
  ): Promise<VerificationJobId> {
    const hardwareInfo = process.env.K_REVISION
      ? `cloud_run:${process.env.K_REVISION}`
      : "unknown";

    const result = await this.database.insertVerificationJob({
      started_at: startTime,
      chain_id: chainId,
      contract_address: bytesFromString(address)!,
      verification_endpoint: verificationEndpoint,
      hardware: hardwareInfo,
    });

    if (result.rowCount === 0) {
      throw new Error("Failed to insert verification job");
    }
    return result.rows[0].id;
  }

  async setJobError(
    verificationId: VerificationJobId,
    finishTime: Date,
    error: VerifyErrorExport,
  ) {
    await this.database.updateVerificationJob({
      id: verificationId,
      completed_at: finishTime,
      verified_contract_id: null,
      compilation_time: null,
      error_code: error.customCode,
      error_id: error.errorId,
      error_data: error.errorData || null,
    });

    await this.database.insertVerificationJobEphemeral({
      id: verificationId,
      recompiled_creation_code:
        bytesFromString(error.recompiledCreationCode) || null,
      recompiled_runtime_code:
        bytesFromString(error.recompiledRuntimeCode) || null,
      onchain_creation_code: bytesFromString(error.onchainCreationCode) || null,
      onchain_runtime_code: bytesFromString(error.onchainRuntimeCode) || null,
      creation_transaction_hash:
        bytesFromString(error.creationTransactionHash) || null,
    });
  }

  private async storeSignatures(
    poolClient: PoolClient,
    verifiedContractId: Tables.VerifiedContract["id"],
    verification: VerificationExport,
  ): Promise<void> {
    try {
      const compiledContractResult =
        await this.database.getCompilationIdForVerifiedContract(
          verifiedContractId,
          poolClient,
        );
      if (compiledContractResult.rowCount === 0) {
        throw new Error(
          `No compilation found for verifiedContractId ${verifiedContractId}`,
        );
      }
      const compilationId = compiledContractResult.rows[0].compilation_id;

      const abi = verification.compilation.contractCompilerOutput.abi;
      if (!abi) {
        if (verification.compilation.language === "Yul") {
          return;
        }
        throw new Error("No ABI found in compilation output");
      }

      const signatureData = extractSignaturesFromAbi(abi);
      const signatureColumns = signatureData.map((sig) => ({
        signature_hash_32: bytesFromString<BytesKeccak>(sig.signatureHash32),
        signature: sig.signature,
        signature_type: sig.signatureType,
      }));

      await this.database.insertSignatures(signatureColumns, poolClient);
      await this.database.insertCompiledContractSignatures(
        compilationId,
        signatureColumns,
        poolClient,
      );

      logger.info("Stored signatures to SourcifyDatabase", {
        verifiedContractId,
        compilationId,
        signatureCount: signatureData.length,
      });
    } catch (error) {
      // Don't throw on errors, the job should not fail
      logger.error("Error storing signatures", {
        verifiedContractId,
        error: error,
      });
    }
  }

  // Override this method to include the SourcifyMatch
  async storeVerificationWithPoolClient(
    poolClient: PoolClient,
    verification: VerificationExport,
    jobData?: {
      verificationId: VerificationJobId;
      finishTime: Date;
    },
  ): Promise<{ verifiedContractId: Tables.VerifiedContract["id"] }> {
    try {
      const { type, verifiedContractId, oldVerifiedContractId } =
        await super.insertOrUpdateVerification(verification, poolClient);

      if (type === "insert") {
        if (!verifiedContractId) {
          throw new Error(
            "VerifiedContractId undefined before inserting sourcify match",
          );
        }
        await this.database.insertSourcifyMatch(
          {
            verified_contract_id: verifiedContractId,
            creation_match: verification.status.creationMatch,
            runtime_match: verification.status.runtimeMatch,
            metadata: verification.compilation.metadata as any,
            chain_id: verification.chainId.toString(),
          },
          poolClient,
        );
        logger.info("Stored to SourcifyDatabase", {
          address: verification.address,
          chainId: verification.chainId,
          runtimeMatch: verification.status.runtimeMatch,
          creationMatch: verification.status.creationMatch,
        });
      } else if (type === "update") {
        if (!oldVerifiedContractId) {
          throw new Error(
            "oldVerifiedContractId undefined before updating sourcify match",
          );
        }
        await this.database.updateSourcifyMatch(
          {
            verified_contract_id: verifiedContractId,
            creation_match: verification.status.creationMatch,
            runtime_match: verification.status.runtimeMatch,
            metadata: verification.compilation.metadata as any,
            chain_id: verification.chainId.toString(),
          },
          oldVerifiedContractId,
          poolClient,
        );
        logger.info("Updated in SourcifyDatabase", {
          address: verification.address,
          chainId: verification.chainId,
          runtimeMatch: verification.status.runtimeMatch,
          creationMatch: verification.status.creationMatch,
        });
      } else {
        throw new Error(
          "insertOrUpdateVerifiedContract returned a type that doesn't exist",
        );
      }

      // Update the verification job to be successful
      if (jobData) {
        await this.database.updateVerificationJob(
          {
            id: jobData.verificationId,
            completed_at: jobData.finishTime,
            verified_contract_id: verifiedContractId,
            compilation_time:
              verification.compilation.compilationTime?.toString() || null,
            error_code: null,
            error_id: null,
            error_data: null,
          },
          poolClient,
        );
      }

      return { verifiedContractId: verifiedContractId };
    } catch (error: any) {
      if (error instanceof ConflictError) {
        logger.warn("Contract already exists in SourcifyDatabase", {
          name: verification.compilation.compilationTarget.name,
          address: verification.address,
        });
        throw error;
      }
      logger.error("Error storing verification", {
        error: error,
      });
      throw error;
    }
  }

  async storeVerification(
    verification: VerificationExport,
    jobData?: {
      verificationId: VerificationJobId;
      finishTime: Date;
    },
  ): Promise<void> {
    const { verifiedContractId } = await this.withTransaction(
      async (transactionPoolClient) => {
        return await this.storeVerificationWithPoolClient(
          transactionPoolClient,
          verification,
          jobData,
        );
      },
    );

    // Separate transaction because storing the verification should not fail
    // if signatures cannot be stored
    await this.withTransaction(async (transactionPoolClient) => {
      await this.storeSignatures(
        transactionPoolClient,
        verifiedContractId,
        verification,
      );
    });
  }

  /**
   * Returns the ids of compilations whose runtime code looks similar to the
   * given bytecode, most-to-least nothing in particular -- the order is
   * whatever the prefix scan produces.
   *
   * Only ids are returned so the caller can fetch the (large) compilation
   * payloads in batches and stop as soon as one of them verifies.
   */
  async getSimilarityCandidateIdsByRuntimeCode(
    runtimeBytecode: string,
    limit: number,
  ): Promise<string[]> {
    await this.init();

    const runtimeBuffer = bytesFromString(runtimeBytecode);
    if (!runtimeBuffer || runtimeBuffer.length === 0) {
      throw new Error("Invalid runtime bytecode");
    }

    const prefixMatches =
      await this.database.getCompilationsByRuntimeCodePrefix(
        // Deployed libraries carry their own address in the call protection at
        // the start of the runtime code; stored prefixes have zeros there.
        normalizeCallProtection(runtimeBuffer),
        limit,
      );

    return prefixMatches.rows.map((row) => row.compilation_id);
  }

  /**
   * Fetches the compilation payloads for a batch of candidate ids in a single
   * query. Each payload carries the full standard JSON input and output, so
   * batches are kept small and only fetched when the previous batch failed to
   * verify.
   */
  async getSimilarityCandidatesByCompilationIds(
    compilationIds: string[],
  ): Promise<SimilarityCandidate[]> {
    await this.init();

    if (compilationIds.length === 0) {
      return [];
    }

    const result = await this.database.getCompilationsByIds(compilationIds);

    if (result.rows.length < compilationIds.length) {
      logger.warn("Some similarity candidates could not be fetched", {
        requested: compilationIds.length,
        fetched: result.rows.length,
      });
    }

    return result.rows as SimilarityCandidate[];
  }

  async getPreRunCompilationFromDatabase(
    chainId: number,
    address: string,
    compilers: {
      solc: ISolidityCompiler;
      vyper: IVyperCompiler;
      fe: IFeCompiler;
    },
  ): Promise<PreRunCompilation> {
    await this.init();

    const addressBuffer = bytesFromString(address);
    if (!addressBuffer) {
      logger.error(
        "getPreRunCompilationFromDatabase: invalid address provided",
        {
          chainId,
          address,
        },
      );
      throw new Error("Invalid address");
    }

    try {
      const verifiedContractResult =
        await this.database.getSourcifyMatchByChainAddressWithProperties(
          chainId,
          addressBuffer,
          [
            "std_json_input",
            "std_json_output",
            "runtime_cbor_auxdata",
            "creation_cbor_auxdata",
            "fully_qualified_name",
            "version",
            "metadata",
          ],
        );

      if (verifiedContractResult.rows.length === 0) {
        logger.error(
          "getPreRunCompilationFromDatabase: verified contract not found",
          {
            chainId,
            address,
          },
        );
        throw new Error("Verified contract not found");
      }

      const candidate = verifiedContractResult
        .rows[0] as GetSourcifyMatchByChainAddressWithPropertiesResult;

      return createPreRunCompilationFromStoredCandidate(
        compilers,
        candidate as SimilarityCandidate,
      );
    } catch (error) {
      logger.error(
        "getPreRunCompilationFromDatabase: error extracting compilation properties",
        {
          error,
          chainId,
          address,
        },
      );
      throw error;
    }
  }
}
