import {
  VerificationStatus,
  StringMap,
  VerificationExport,
} from "@ethereum-sourcify/lib-sourcify";
import StoreBase from "./StoreBase";
import { RWStorageService } from "./StoreBase";
import { Field, FIELDS_TO_STORED_PROPERTIES, StoredProperties } from "./Tables";
import {
  ContractData,
  FileObject,
  FilesInfo,
  FilesRaw,
  FilesRawValue,
  V1MatchLevel,
  V1MatchLevelWithoutAny,
  PaginatedData,
  Pagination,
  VerifiedContractMinimal,
  VerifiedContract,
  VerificationJob,
  Match,
  VerificationJobId,
} from "../../routes/types";
import Path from "path";
import {
  getFileRelativePath,
  getTotalMatchLevel,
  isBetterVerification,
  reduceAccessorStringToProperty,
  toMatchLevel,
} from "../utils/util";
import { getAddress, id as keccak256Str } from "ethers";
import { BadRequestError, ConflictError } from "../../common/errors";
import semver from "semver";
import {
  getVerificationErrorMessage,
  VerificationErrorCode,
} from "../../routes/api/errors";
import { VerifyErrorExport } from "../workers/workerTypes";
import { DatabaseOptions } from "../../config/Loader";

const MAX_RETURNED_CONTRACTS_BY_GETCONTRACTS = 200;

export class StoreService extends StoreBase implements RWStorageService {
  constructor(options: DatabaseOptions) {
    super(options);
  }

  async checkByChainAndAddress(
    address: string,
    chainId: number,
  ): Promise<Match[]> {
    return this.checkByChainAndAddressAndMatch(address, chainId, true);
  }

  async checkAllByChainAndAddress(
    address: string,
    chainId: number,
  ): Promise<Match[]> {
    return this.checkByChainAndAddressAndMatch(address, chainId, false);
  }

  async checkByChainAndAddressAndMatch(
    address: string,
    chainId: number,
    onlyPerfectMatches: boolean = false,
  ): Promise<Match[]> {
    await this.init();

    const existingVerifiedContractResult =
      await this.database.getSourcifyMatchByChainAddress(
        chainId,
        address!,
        onlyPerfectMatches,
      );
    if (!existingVerifiedContractResult) {
      return [];
    }

    return [
      {
        address,
        chainId,
        runtimeMatch:
          existingVerifiedContractResult.runtime_match as VerificationStatus,
        creationMatch:
          existingVerifiedContractResult.creation_match as VerificationStatus,
        storageTimestamp: existingVerifiedContractResult.created_at,
        onchainRuntimeBytecode:
          existingVerifiedContractResult.onchain_runtime_code,
        contractName: existingVerifiedContractResult.name,
      },
    ];
  }

  getContracts = async (chainId: number): Promise<ContractData> => {
    await this.init();

    const res: ContractData = {
      full: [],
      partial: [],
    };
    const matchAddressesCountResult =
      await this.database.countSourcifyMatchAddresses(chainId);

    if (!matchAddressesCountResult) {
      return res;
    }

    const fullTotal = matchAddressesCountResult.full_total;
    const partialTotal = matchAddressesCountResult.partial_total;
    if (
      fullTotal > MAX_RETURNED_CONTRACTS_BY_GETCONTRACTS ||
      partialTotal > MAX_RETURNED_CONTRACTS_BY_GETCONTRACTS
    ) {
      console.info(
        "Requested more than MAX_RETURNED_CONTRACTS_BY_GETCONTRACTS contracts",
        {
          maxReturnedContracts: MAX_RETURNED_CONTRACTS_BY_GETCONTRACTS,
          chainId,
        },
      );
      throw new BadRequestError(
        `Cannot fetch more than ${MAX_RETURNED_CONTRACTS_BY_GETCONTRACTS} contracts (${fullTotal} full matches, ${partialTotal} partial matches), please use /contracts/{full|any|partial}/${chainId} with pagination`,
      );
    }

    if (fullTotal > 0) {
      const perfectMatchAddressesResult =
        await this.database.getSourcifyMatchAddressesByChainAndMatch(
          chainId,
          "full_match",
          0,
          MAX_RETURNED_CONTRACTS_BY_GETCONTRACTS,
        );

      if (perfectMatchAddressesResult?.length) {
        res.full = perfectMatchAddressesResult.map((row) =>
          getAddress(row.address),
        );
      }
    }

    if (partialTotal > 0) {
      const partialMatchAddressesResult =
        await this.database.getSourcifyMatchAddressesByChainAndMatch(
          chainId,
          "partial_match",
          0,
          MAX_RETURNED_CONTRACTS_BY_GETCONTRACTS,
        );

      if (partialMatchAddressesResult?.length) {
        res.partial = partialMatchAddressesResult.map((row) =>
          getAddress(row.address),
        );
      }
    }

    return res;
  };

  getPaginationForContracts = async (
    chainId: number,
    match: V1MatchLevel,
    page: number,
    limit: number,
    currentPageCount: number,
  ): Promise<Pagination> => {
    await this.init();

    // Initialize empty result
    const pagination: Pagination = {
      currentPage: page,
      resultsPerPage: limit,
      resultsCurrentPage: currentPageCount,
      totalResults: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    };

    // Count perfect and partial matches
    const matchAddressesCountResult =
      await this.database.countSourcifyMatchAddresses(chainId);
    if (!matchAddressesCountResult) {
      return pagination;
    }

    // Calculate totalResults, return empty res if there are no contracts
    const fullTotal = matchAddressesCountResult.full_total;
    const partialTotal = matchAddressesCountResult.partial_total;

    const anyTotal = fullTotal + partialTotal;
    const matchTotals: Record<V1MatchLevel, number> = {
      full_match: fullTotal,
      partial_match: partialTotal,
      any_match: anyTotal,
    };
    // return empty res if requested `match` total is zero
    if (matchTotals[match] === 0) {
      return pagination;
    }
    pagination.totalResults = matchTotals[match];

    pagination.totalPages = Math.ceil(
      pagination.totalResults / pagination.resultsPerPage,
    );

    if (currentPageCount > 0) {
      pagination.hasNextPage =
        pagination.currentPage * pagination.resultsPerPage + currentPageCount <
        pagination.totalResults;
      pagination.hasPreviousPage = pagination.currentPage === 0 ? false : true;
    }

    return pagination;
  };

  getPaginatedContractAddresses = async (
    chainId: number,
    match: V1MatchLevel,
    page: number,
    limit: number,
    descending: boolean = false,
  ): Promise<PaginatedData<string>> => {
    await this.init();

    const matchAddressesResult =
      await this.database.getSourcifyMatchAddressesByChainAndMatch(
        chainId,
        match,
        page,
        limit,
        descending,
      );
    const results = matchAddressesResult.map((row) => getAddress(row.address));

    const pagination = await this.getPaginationForContracts(
      chainId,
      match,
      page,
      limit,
      matchAddressesResult?.length ?? 0,
    );

    return { pagination, results };
  };

  /**
   * getFiles extracts the files from the database `compiled_contracts_sources`
   * and store them into FilesInfo.files, this object is then going to be formatted
   * by getTree, getContent and getFile.
   */
  getFiles = async (chainId: number, address: string): Promise<FilesRaw> => {
    await this.init();

    const sourcifyMatch = await this.database.getSourcifyMatchByChainAddress(
      chainId,
      address!,
    );
    if (!sourcifyMatch) {
      // This is how you handle a non existing contract
      return { status: "partial", files: {}, sources: {} };
    }

    // If either one of sourcify_matches.creation_match or sourcify_matches.runtime_match is perfect then "full" status
    const contractStatus =
      sourcifyMatch.creation_match === "perfect" ||
      sourcifyMatch.runtime_match === "perfect"
        ? "full"
        : "partial";

    const sourcesResult = await this.database.getCompiledContractSources(
      sourcifyMatch.compilation_id,
    );
    const sources = sourcesResult.reduce(
      (sources, source) => {
        // Add 'sources/' prefix for API compatibility with the repoV1 responses. RepoV1 filesystem has all source files in 'sources/'
        sources[`sources/${source.path}`] = source.content;
        return sources;
      },
      {} as Record<string, string>,
    );
    const files: FilesRawValue = {};

    if (sourcifyMatch.metadata) {
      files["metadata.json"] = JSON.stringify(sourcifyMatch.metadata);
    }

    if (sourcifyMatch?.creation_values?.constructorArguments) {
      files["constructor-args.txt"] =
        sourcifyMatch.creation_values.constructorArguments;
    }

    if (sourcifyMatch?.transaction_hash) {
      const creatorTxHash = sourcifyMatch.transaction_hash;
      if (creatorTxHash) {
        files["creator-tx-hash.txt"] = `0x${creatorTxHash}`;
      }
    }

    if (
      sourcifyMatch?.runtime_values?.libraries &&
      Object.keys(sourcifyMatch.runtime_values.libraries).length > 0
    ) {
      // Must convert "contracts/file.sol:MyLib" FQN format to the placeholder format __$keccak256(file.sol:MyLib)$___ or  __MyLib__________
      const formattedLibraries: StringMap = {};
      for (const [key, value] of Object.entries(
        sourcifyMatch.runtime_values.libraries,
      )) {
        let formattedKey;
        // Solidity >= 0.5.0 is __$keccak256(file.sol:MyLib)$__ (total 40 characters)
        if (semver.gte(sourcifyMatch.metadata.compiler.version, "0.5.0")) {
          formattedKey =
            "__$" + keccak256Str(key).slice(2).slice(0, 34) + "$__";
        } else {
          // Solidity < 0.5.0 is __MyLib__________ (total 40 characters)
          const libName = key.split(":")[1];
          const trimmedLibName = libName.slice(0, 36); // in case it's longer
          formattedKey = "__" + trimmedLibName.padEnd(38, "_");
        }
        formattedLibraries[formattedKey] = value;
      }
      files["library-map.json"] = JSON.stringify(formattedLibraries);
    }

    if (
      sourcifyMatch?.runtime_code_artifacts?.immutableReferences &&
      Object.keys(sourcifyMatch.runtime_code_artifacts.immutableReferences)
        .length > 0
    ) {
      files["immutable-references.json"] = JSON.stringify(
        sourcifyMatch.runtime_code_artifacts.immutableReferences,
      );
    }

    return { status: contractStatus, sources, files };
  };

  getFile = async (
    chainId: number,
    address: string,
    match: V1MatchLevelWithoutAny,
    path: string,
  ): Promise<string | false> => {
    // this.getFiles queries sourcify_match, it extract always one and only one match
    // there could never be two matches with different MatchLevelWithoutAny inside sourcify_match
    const { status, files, sources } = await this.getFiles(chainId, address);

    if (Object.keys(sources).length === 0) {
      return false;
    }

    // returned getFile.status should equal requested MatchLevelWithoutAny
    if (status === "full" && match !== "full_match") {
      return false;
    }
    if (status === "partial" && match !== "partial_match") {
      return false;
    }

    const allFiles: { [index: string]: string } = {
      ...files,
      ...sources,
    };

    if (match === "full_match" && status === "full") {
      return allFiles[path];
    }

    if (match === "partial_match" && status === "partial") {
      return allFiles[path];
    }

    return false;
  };

  /**
   * getContent returns FilesInfo in which files contains for each source its FileObject,
   * an object that includes the content of the file.
   */
  getContent = async (
    chainId: number,
    address: string,
    match: V1MatchLevel,
  ): Promise<FilesInfo<Array<FileObject>>> => {
    const {
      status: contractStatus,
      sources: sourcesRaw,
      files: filesRaw,
    } = await this.getFiles(chainId, address);

    const emptyResponse: FilesInfo<Array<FileObject>> = {
      status: "full",
      files: [],
    };

    // If "full_match" files are requestd but the contractStatus if partial return empty
    if (match === "full_match" && contractStatus === "partial") {
      return emptyResponse;
    }

    // Calculate the the repository's url for each file
    const sourcesWithUrl = Object.keys(sourcesRaw).map((source) => {
      const relativePath = getFileRelativePath(
        chainId,
        address,
        contractStatus,
        source,
      );

      return {
        name: Path.basename(source),
        path: relativePath,
        content: sourcesRaw[source],
      } as FileObject;
    });

    const filesWithUrl = Object.keys(filesRaw).map((file) => {
      const relativePath = getFileRelativePath(
        chainId,
        address,
        contractStatus,
        file,
      );

      return {
        name: Path.basename(file),
        path: relativePath,
        content: filesRaw[file],
      } as FileObject;
    });

    const response = {
      status: contractStatus,
      files: [...sourcesWithUrl, ...filesWithUrl],
    };

    // if files is empty it means that the contract doesn't exist
    if (response.files.length === 0) {
      return emptyResponse;
    }

    return response;
  };

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
    chainId: number,
    limit: number,
    descending: boolean,
    afterMatchId?: string,
    addresses?: string[],
  ): Promise<{ results: VerifiedContractMinimal[] }> => {
    await this.init();

    const sourcifyMatchesResult = await this.database.getSourcifyMatchesByChain(
      chainId,
      limit,
      descending,
      afterMatchId,
      addresses,
    );

    const results: VerifiedContractMinimal[] = sourcifyMatchesResult.map(
      (row) => ({
        match: getTotalMatchLevel(row.creation_match, row.runtime_match),
        creationMatch: toMatchLevel(row.creation_match),
        runtimeMatch: toMatchLevel(row.runtime_match),
        chainId,
        address: getAddress(row.address),
        verifiedAt: row.verified_at,
        matchId: row.id,
        name: row.name,
      }),
    );

    return { results };
  };

  getContract = async (
    chainId: number,
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
      "licenseType",
      "contractLabel",
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

    // Retrieve database result
    const sourcifyMatchResult =
      await this.database.getSourcifyMatchByChainAddressWithProperties(
        chainId,
        address,
        requestedProperties,
      );

    if (!sourcifyMatchResult) {
      /*console.debug("No sourcify match found for contract", {
        chainId,
        address,
      });*/
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
            sourcifyMatchResult[property as StoredProperties],
          );
        } else {
          // The whole subobject is requested, e.g. the creationBytecode object
          for (const [subfield, subproperty] of Object.entries(property)) {
            addToContract(
              fullField,
              subfield,
              sourcifyMatchResult[subproperty as StoredProperties],
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

    return result;
  };

  getVerificationJob = async (
    verificationId: string,
  ): Promise<VerificationJob | null> => {
    const row = await this.database.getVerificationJobById(verificationId);
    if (!row) {
      return null;
    }

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
    const job: VerificationJob = {
      isJobCompleted: !!row.completed_at,
      verificationId,
      jobStartTime: row.started_at,
      jobFinishTime: row.completed_at || undefined,
      compilationTime: row.compilation_time || undefined,
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
          chainId: String(row.chain_id),
          address,
          ...row.error_data,
        }),
        errorId: row.error_id,
        recompiledCreationCode: row.recompiled_creation_code || undefined,
        recompiledRuntimeCode: row.recompiled_runtime_code || undefined,
        onchainCreationCode: row.onchain_creation_code || undefined,
        onchainRuntimeCode: row.onchain_runtime_code || undefined,
        creationTransactionHash: row.creation_transaction_hash || undefined,
      };
    }

    return job;
  };

  getVerificationJobsByChainAndAddress = async (
    chainId: number,
    address: string,
  ): Promise<Pick<VerificationJob, "isJobCompleted" | "verificationId">[]> => {
    const result = await this.database.getVerificationJobsByChainAndAddress(
      chainId,
      address,
    );
    return result.map((row) => ({
      verificationId: row.id,
      isJobCompleted: !!row.completed_at,
    }));
  };

  async storeVerificationJob(
    startTime: Date,
    chainId: number,
    address: string,
    verificationEndpoint: string,
  ): Promise<VerificationJobId> {
    const hardwareInfo = process.env.K_REVISION
      ? `cloud_run:${process.env.K_REVISION}`
      : "unknown";

    const result = await this.database.insertVerificationJob({
      started_at: startTime,
      chain_id: chainId,
      contract_address: address!,
      verification_endpoint: verificationEndpoint,
      hardware: hardwareInfo,
    });

    if (!result) {
      throw new Error("Failed to insert verification job");
    }
    return result.id;
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
      recompiled_creation_code: error.recompiledCreationCode || null,
      recompiled_runtime_code: error.recompiledRuntimeCode || null,
      onchain_creation_code: error.onchainCreationCode || null,
      onchain_runtime_code: error.onchainRuntimeCode || null,
      creation_transaction_hash: error.creationTransactionHash || null,
    });
  }

  // Override this method to include the SourcifyMatch
  async _storeVerification(
    verification: VerificationExport,
    jobData?: {
      verificationId: VerificationJobId;
      finishTime: Date;
    },
    licenseType?: number,
    contractLabel?: string,
  ): Promise<void> {
    const { type, verifiedContractId, oldVerifiedContractId } =
      await super.insertOrUpdateVerification(verification);
    const matchInfo = {
      address: verification.address,
      chainId: verification.chainId,
      runtimeMatch: verification.status.runtimeMatch,
      creationMatch: verification.status.creationMatch,
    };

    if (type === "insert") {
      if (!verifiedContractId) {
        throw new Error(
          "VerifiedContractId undefined before inserting sourcify match",
        );
      }
      await this.database.insertSourcifyMatch({
        verified_contract_id: verifiedContractId,
        creation_match: verification.status.creationMatch,
        runtime_match: verification.status.runtimeMatch,
        metadata: verification.compilation.metadata as any,
        license_type: licenseType,
        contract_label: contractLabel,
      });
      console.info("Stored to SourcifyDatabase", matchInfo);
    } else if (type === "update") {
      if (!oldVerifiedContractId) {
        throw new Error(
          "oldVerifiedContractId undefined before updating sourcify match",
        );
      }
      const [, effectRows] = await this.database.updateSourcifyMatch(
        {
          verified_contract_id: verifiedContractId,
          creation_match: verification.status.creationMatch,
          runtime_match: verification.status.runtimeMatch,
          metadata: verification.compilation.metadata as any,
          license_type: licenseType,
          contract_label: contractLabel,
        },
        oldVerifiedContractId,
      );
      if (effectRows) {
        console.info("Updated in SourcifyDatabase", matchInfo);
      } else {
        await this.database.insertSourcifyMatch({
          verified_contract_id: verifiedContractId,
          creation_match: verification.status.creationMatch,
          runtime_match: verification.status.runtimeMatch,
          metadata: verification.compilation.metadata as any,
          license_type: licenseType,
          contract_label: contractLabel,
        });
        console.info("Stored to SourcifyDatabase", matchInfo);
      }
    } else {
      throw new Error(
        "insertOrUpdateVerifiedContract returned a type that doesn't exist",
      );
    }

    // Update the verification job to be successful
    if (jobData) {
      await this.database.updateVerificationJob({
        id: jobData.verificationId,
        completed_at: jobData.finishTime,
        verified_contract_id: verifiedContractId,
        compilation_time: verification.compilation.compilationTime || null,
        error_code: null,
        error_id: null,
        error_data: null,
      });
    }
  }

  async storeVerification(
    verification: VerificationExport,
    jobData?: {
      verificationId: VerificationJobId;
      finishTime: Date;
    },
    licenseType?: number,
    contractLabel?: string,
  ) {
    const existingMatch = await this.checkAllByChainAndAddress(
      verification.address,
      verification.chainId,
    );
    if (
      existingMatch.length > 0 &&
      !isBetterVerification(verification, existingMatch[0])
    ) {
      throw new ConflictError(
        `The contract ${verification.address} on chainId ${verification.chainId} is already partially verified. The provided new source code also yielded a partial match and will not be stored unless it's a full match`,
      );
    }
    await this._storeVerification(
      verification,
      jobData,
      licenseType,
      contractLabel,
    ).catch((e: any) => {
      throw e;
    });
  }
}
