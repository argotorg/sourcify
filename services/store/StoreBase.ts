import { VerificationExport } from "@ethereum-sourcify/lib-sourcify";
import {
  DatabaseColumns,
  Field,
  getDatabaseColumnsFromVerification,
  Tables,
} from "./Tables";
import { Dao } from "./Dao";
import {
  ContractData,
  FileObject,
  FilesInfo,
  Match,
  PaginatedData,
  V1MatchLevel,
  V1MatchLevelWithoutAny,
  VerificationJob,
  VerificationJobId,
  VerifiedContract,
  VerifiedContractMinimal,
} from "../../routes/types";
import { VerifyErrorExport } from "../workers/workerTypes";
import { DatabaseOptions } from "../../config/Loader";

export default class StoreBase {
  public database: Dao;

  constructor(options: DatabaseOptions) {
    this.database = new Dao(options);
  }

  async init() {
    return await this.database.init();
  }

  validateVerificationBeforeStoring(verification: VerificationExport): boolean {
    if (
      verification.status.runtimeMatch === null ||
      verification.status.creationMatch === null
    ) {
      throw new Error(
        `can only store contracts with both runtimeMatch and creationMatch. address=${verification.address} chainId=${verification.chainId}`,
      );
    }
    if (
      verification.compilation.runtimeBytecode === undefined ||
      verification.compilation.creationBytecode === undefined
    ) {
      throw new Error(
        `can only store contracts with both runtimeBytecode and creationBytecode. address=${verification.address} chainId=${verification.chainId}`,
      );
    }
    if (verification.deploymentInfo.txHash === undefined) {
      throw new Error(
        `can only store matches with creatorTxHash. address=${verification.address} chainId=${verification.chainId}`,
      );
    }
    return true;
  }

  async insertNewVerifiedContract(
    databaseColumns: DatabaseColumns,
  ): Promise<number> {
    try {
      const { sequelize } = Tables.VerifiedContract;
      if (!sequelize) {
        throw new Error("The sequelize not initialized");
      }
      return sequelize.transaction(async (dbTx) => {
        // Add recompiled bytecodes
        let recompiledCreationCode:
          | Pick<Tables.ICode, "bytecode_hash">
          | undefined;
        let onchainCreationCode:
          | Pick<Tables.ICode, "bytecode_hash">
          | undefined;
        if (databaseColumns.recompiledCreationCode) {
          recompiledCreationCode = await this.database.insertCode(
            databaseColumns.recompiledCreationCode,
            dbTx,
          );
        }
        const recompiledRuntimeCode = await this.database.insertCode(
          databaseColumns.recompiledRuntimeCode,
          dbTx,
        );

        // Add onchain bytecodes
        if (databaseColumns.onchainCreationCode) {
          onchainCreationCode = await this.database.insertCode(
            databaseColumns.onchainCreationCode,
            dbTx,
          );
        }
        const onchainRuntimeCode = await this.database.insertCode(
          databaseColumns.onchainRuntimeCode,
          dbTx,
        );

        // Add onchain contract in contracts
        const contract = await this.database.insertContract(
          {
            creation_bytecode_hash: onchainCreationCode?.bytecode_hash,
            runtime_bytecode_hash: onchainRuntimeCode.bytecode_hash,
          },
          dbTx,
        );

        // Add onchain contract in contract_deployments
        const contractDeployment = await this.database.insertContractDeployment(
          {
            ...databaseColumns.contractDeployment,
            contract_id: contract.id,
          },
          dbTx,
        );

        // Add recompiled contract
        const compiledContract = await this.database.insertCompiledContract(
          {
            ...databaseColumns.compiledContract,
            creation_code_hash: recompiledCreationCode?.bytecode_hash,
            runtime_code_hash: recompiledRuntimeCode.bytecode_hash,
          },
          dbTx,
        );

        // Add recompiled contract sources
        await this.database.insertCompiledContractsSources(
          {
            sourcesInformation: databaseColumns.sourcesInformation,
            compilation_id: compiledContract.id,
          },
          dbTx,
        );

        // Add verified contract
        const verifiedContract = await this.database.insertVerifiedContract(
          {
            ...databaseColumns.verifiedContract,
            compilation_id: compiledContract.id,
            deployment_id: contractDeployment.id,
          },
          dbTx,
        );

        return verifiedContract.id;
      });
    } catch (e) {
      throw new Error(
        `cannot insert verified_contract address=${databaseColumns.contractDeployment.address} chainId=${databaseColumns.contractDeployment.chain_id}\n${e}`,
      );
    }
  }

  async updateExistingVerifiedContract(
    databaseColumns: DatabaseColumns,
  ): Promise<number> {
    // runtime bytecodes must exist
    if (databaseColumns.recompiledRuntimeCode.bytecode === undefined) {
      throw new Error("Missing normalized runtime bytecode");
    }
    if (databaseColumns.onchainRuntimeCode.bytecode === undefined) {
      throw new Error("Missing onchain runtime bytecode");
    }

    try {
      const { sequelize } = Tables.VerifiedContract;
      if (!sequelize) {
        throw new Error("The sequelize not initialized");
      }
      return sequelize.transaction(async (dbTx) => {
        // Add onchain bytecodes
        let onchainCreationCode: Pick<Tables.Code, "bytecode_hash"> | undefined;
        if (databaseColumns.onchainCreationCode) {
          onchainCreationCode = await this.database.insertCode(
            databaseColumns.onchainCreationCode,
            dbTx,
          );
        }
        const onchainRuntimeCode = await this.database.insertCode(
          databaseColumns.onchainRuntimeCode,
          dbTx,
        );

        // Add onchain contract in contracts
        const contract = await this.database.insertContract(
          {
            creation_bytecode_hash: onchainCreationCode?.bytecode_hash,
            runtime_bytecode_hash: onchainRuntimeCode.bytecode_hash,
          },
          dbTx,
        );

        // Add onchain contract in contract_deployments
        const contractDeployment = await this.database.insertContractDeployment(
          {
            ...databaseColumns.contractDeployment,
            contract_id: contract.id,
          },
          dbTx,
        );

        // Add recompiled bytecodes
        let recompiledCreationCode:
          | Pick<Tables.Code, "bytecode_hash">
          | undefined;
        if (databaseColumns.recompiledCreationCode) {
          recompiledCreationCode = await this.database.insertCode(
            databaseColumns.recompiledCreationCode,
            dbTx,
          );
        }
        const recompiledRuntimeCode = await this.database.insertCode(
          databaseColumns.recompiledRuntimeCode,
          dbTx,
        );

        // Add recompiled contract
        const compiledContracts = await this.database.insertCompiledContract(
          {
            ...databaseColumns.compiledContract,
            creation_code_hash: recompiledCreationCode?.bytecode_hash,
            runtime_code_hash: recompiledRuntimeCode.bytecode_hash,
          },
          dbTx,
        );

        // Add recompiled contract sources
        await this.database.insertCompiledContractsSources(
          {
            sourcesInformation: databaseColumns.sourcesInformation,
            compilation_id: compiledContracts.id,
          },
          dbTx,
        );

        // update verified contract with the newly added recompiled contract
        const verifiedContract = await this.database.insertVerifiedContract(
          {
            ...databaseColumns.verifiedContract,
            compilation_id: compiledContracts.id,
            deployment_id: contractDeployment.id,
          },
          dbTx,
        );

        return verifiedContract.id;
      });
    } catch (e) {
      throw new Error(
        `cannot update verified_contract address=${databaseColumns.contractDeployment.address} chainId=${databaseColumns.contractDeployment.chain_id}\n${e}`,
      );
    }
  }

  async insertOrUpdateVerification(verification: VerificationExport): Promise<{
    type: "update" | "insert";
    verifiedContractId: number;
    oldVerifiedContractId?: number;
  }> {
    this.validateVerificationBeforeStoring(verification);

    const existingVerifiedContractResult =
      await this.database.getVerifiedContractByChainAndAddress(
        verification.chainId,
        verification.address!,
      );
    const databaseColumns =
      await getDatabaseColumnsFromVerification(verification);

    if (!existingVerifiedContractResult) {
      return {
        type: "insert",
        verifiedContractId:
          await this.insertNewVerifiedContract(databaseColumns),
      };
    } else {
      return {
        type: "update",
        verifiedContractId:
          await this.updateExistingVerifiedContract(databaseColumns),
        oldVerifiedContractId: existingVerifiedContractResult.id,
      };
    }
  }

  async insertNewSimilarContract(
    chainId: number,
    address: string,
    codeHash: string,
  ): Promise<number> {
    try {
      const contractDeployment =
        await this.database.getContractDeploymentByRuntimeCodeHash(codeHash);
      if (!contractDeployment) {
        throw new Error("Failed to find contract-deployment.");
      }
      const verifiedContract =
        await this.database.getVerifiedContractByContractDeploymentId(
          contractDeployment.id,
        );
      if (!verifiedContract) {
        throw new Error("Failed to find verified-contract.");
      }
      const sourcifyMatch =
        await this.database.getSourcifyMatchByVerifiedContractId(
          verifiedContract.id,
        );
      if (!sourcifyMatch) {
        throw new Error("Failed to find sourcify-match.");
      }

      const { sequelize } = Tables.VerifiedContract;
      if (!sequelize) {
        throw new Error("Failed to init the sequelize.");
      }

      return sequelize.transaction(async (dbTx) => {
        const deployment = await this.database.insertContractDeployment(
          {
            chain_id: chainId,
            address: address,
            contract_id: contractDeployment.contract_id,
          },
          dbTx,
        );
        const verified = await this.database.insertVerifiedContract(
          {
            ...verifiedContract,
            deployment_id: deployment.id,
          },
          dbTx,
        );
        return this.database.insertSourcifyMatch(
          {
            ...sourcifyMatch,
            verified_contract_id: verified.id,
            similar_match_chain_id: contractDeployment.chain_id,
            similar_match_address: contractDeployment.address,
          },
          dbTx,
        );
      });
    } catch (e) {
      throw new Error(
        `Failed to insert similar contract address=${address} chainId=${chainId}\n${e}`,
      );
    }
  }
}

export interface WStorageService {
  init(): Promise<boolean>;
  storeVerification(
    verification: VerificationExport,
    jobData?: {
      verificationId: VerificationJobId;
      finishTime: Date;
    },
  ): Promise<void>;
  storeVerificationJob?(
    startedAt: Date,
    chainId: number,
    address: string,
    verificationEndpoint: string,
  ): Promise<VerificationJobId>;
  setJobError?(
    verificationId: VerificationJobId,
    finishTime: Date,
    error: VerifyErrorExport,
  ): Promise<void>;
}

export interface RWStorageService extends WStorageService {
  getFile(
    chainId: number,
    address: string,
    match: V1MatchLevelWithoutAny,
    path: string,
  ): Promise<string | false>;
  getContent(
    chainId: number,
    address: string,
    match: V1MatchLevel,
  ): Promise<FilesInfo<Array<FileObject>>>;
  getContracts(chainId: number): Promise<ContractData>;
  getPaginatedContractAddresses?(
    chainId: number,
    match: V1MatchLevel,
    page: number,
    limit: number,
    descending: boolean,
  ): Promise<PaginatedData<string>>;
  checkByChainAndAddress(address: string, chainId: number): Promise<Match[]>;
  checkAllByChainAndAddress(address: string, chainId: number): Promise<Match[]>;
  getContractsByChainId?(
    chainId: number,
    limit: number,
    descending: boolean,
    afterMatchId?: string,
  ): Promise<{ results: VerifiedContractMinimal[] }>;
  getContract?(
    chainId: number,
    address: string,
    fields?: Field[],
    omit?: Field[],
  ): Promise<VerifiedContract>;
  getVerificationJob?(verificationId: string): Promise<VerificationJob | null>;
  getVerificationJobsByChainAndAddress?(
    chainId: number,
    address: string,
  ): Promise<Pick<VerificationJob, "isJobCompleted">[]>;
}
