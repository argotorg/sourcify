import type { VerificationExport } from "@ethereum-sourcify/lib-sourcify";
import * as DatabaseUtil from "../utils/database-util";
import type { Tables } from "../utils/database-util";
import { bytesFromString } from "../utils/database-util";
import type { DatabaseOptions } from "../utils/Database";
import { Database } from "../utils/Database";
import type { PoolClient, QueryResult } from "pg";

export default abstract class AbstractDatabaseService {
  public database: Database;
  abstract IDENTIFIER: string;

  constructor(options: DatabaseOptions) {
    this.database = new Database(options);
  }

  async init() {
    return await this.database.initDatabasePool(this.IDENTIFIER);
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
    databaseColumns: DatabaseUtil.DatabaseColumns,
    client: PoolClient,
  ): Promise<Tables.VerifiedContract["id"]> {
    try {
      let recompiledCreationCodeInsertResult:
        | QueryResult<Pick<DatabaseUtil.Tables.Code, "bytecode_hash">>
        | undefined;
      let onchainCreationCodeInsertResult:
        | QueryResult<Pick<DatabaseUtil.Tables.Code, "bytecode_hash">>
        | undefined;

      // Add recompiled bytecodes
      if (databaseColumns.recompiledCreationCode) {
        recompiledCreationCodeInsertResult = await this.database.insertCode(
          client,
          databaseColumns.recompiledCreationCode,
        );
      }
      const recompiledRuntimeCodeInsertResult = await this.database.insertCode(
        client,
        databaseColumns.recompiledRuntimeCode,
      );

      // Add onchain bytecodes
      if (databaseColumns.onchainCreationCode) {
        onchainCreationCodeInsertResult = await this.database.insertCode(
          client,
          databaseColumns.onchainCreationCode,
        );
      }
      const onchainRuntimeCodeInsertResult = await this.database.insertCode(
        client,
        databaseColumns.onchainRuntimeCode,
      );

      // Add the onchain contract in contracts
      const contractInsertResult = await this.database.insertContract(client, {
        creation_bytecode_hash:
          onchainCreationCodeInsertResult?.rows[0].bytecode_hash,
        runtime_bytecode_hash:
          onchainRuntimeCodeInsertResult.rows[0].bytecode_hash,
      });

      // add the onchain contract in contract_deployments
      const contractDeploymentInsertResult =
        await this.database.insertContractDeployment(client, {
          ...databaseColumns.contractDeployment,
          contract_id: contractInsertResult.rows[0].id,
        });

      // insert new recompiled contract
      const compiledContractsInsertResult =
        await this.database.insertCompiledContract(client, {
          ...databaseColumns.compiledContract,
          creation_code_hash:
            recompiledCreationCodeInsertResult?.rows[0].bytecode_hash,
          runtime_code_hash:
            recompiledRuntimeCodeInsertResult.rows[0].bytecode_hash,
        });

      const compiledContractId = compiledContractsInsertResult.rows[0].id;

      await this.database.insertCompiledContractsSources(client, {
        sourcesInformation: databaseColumns.sourcesInformation,
        compilation_id: compiledContractId,
      });

      // insert new recompiled contract with newly added contract and compiledContract
      const verifiedContractInsertResult =
        await this.database.insertVerifiedContract(client, {
          ...databaseColumns.verifiedContract,
          compilation_id: compiledContractId,
          deployment_id: contractDeploymentInsertResult.rows[0].id,
        });
      return verifiedContractInsertResult.rows[0].id;
    } catch (e) {
      throw new Error(
        `cannot insert verified_contract address=0x${databaseColumns.contractDeployment.address.toString("hex")} chainId=${databaseColumns.contractDeployment.chain_id}\n${e}`,
      );
    }
  }

  async updateExistingVerifiedContract(
    databaseColumns: DatabaseUtil.DatabaseColumns,
    client: PoolClient,
  ): Promise<Tables.VerifiedContract["id"]> {
    // runtime bytecodes must exist
    if (databaseColumns.recompiledRuntimeCode.bytecode === undefined) {
      throw new Error("Missing normalized runtime bytecode");
    }
    if (databaseColumns.onchainRuntimeCode.bytecode === undefined) {
      throw new Error("Missing onchain runtime bytecode");
    }

    // Get a client from the pool, so that we can execute all the insert queries within the same transaction
    try {
      let onchainCreationCodeInsertResult:
        | QueryResult<Pick<DatabaseUtil.Tables.Code, "bytecode_hash">>
        | undefined;

      // Add onchain bytecodes
      if (databaseColumns.onchainCreationCode) {
        onchainCreationCodeInsertResult = await this.database.insertCode(
          client,
          databaseColumns.onchainCreationCode,
        );
      }

      const onchainRuntimeCodeInsertResult = await this.database.insertCode(
        client,
        databaseColumns.onchainRuntimeCode,
      );

      // Add the onchain contract in contracts
      const contractInsertResult = await this.database.insertContract(client, {
        creation_bytecode_hash:
          onchainCreationCodeInsertResult?.rows[0].bytecode_hash,
        runtime_bytecode_hash:
          onchainRuntimeCodeInsertResult.rows[0].bytecode_hash,
      });

      // add the onchain contract in contract_deployments
      const contractDeploymentInsertResult =
        await this.database.insertContractDeployment(client, {
          ...databaseColumns.contractDeployment,
          contract_id: contractInsertResult.rows[0].id,
        });
      const contractDeploymentId = contractDeploymentInsertResult.rows[0].id;

      // Add recompiled bytecodes
      let recompiledCreationCodeInsertResult:
        | QueryResult<Pick<DatabaseUtil.Tables.Code, "bytecode_hash">>
        | undefined;
      if (databaseColumns.recompiledCreationCode) {
        recompiledCreationCodeInsertResult = await this.database.insertCode(
          client,
          databaseColumns.recompiledCreationCode,
        );
      }
      const recompiledRuntimeCodeInsertResult = await this.database.insertCode(
        client,
        databaseColumns.recompiledRuntimeCode,
      );

      // insert new recompiled contract
      const compiledContractsInsertResult =
        await this.database.insertCompiledContract(client, {
          ...databaseColumns.compiledContract,
          creation_code_hash:
            recompiledCreationCodeInsertResult?.rows[0].bytecode_hash,
          runtime_code_hash:
            recompiledRuntimeCodeInsertResult.rows[0].bytecode_hash,
        });

      const compiledContractId = compiledContractsInsertResult.rows[0].id;

      await this.database.insertCompiledContractsSources(client, {
        sourcesInformation: databaseColumns.sourcesInformation,
        compilation_id: compiledContractId,
      });

      // update verified contract with the newly added recompiled contract
      const verifiedContractInsertResult =
        await this.database.insertVerifiedContract(client, {
          ...databaseColumns.verifiedContract,
          compilation_id: compiledContractsInsertResult.rows[0].id,
          deployment_id: contractDeploymentId,
        });

      return verifiedContractInsertResult.rows[0].id;
    } catch (e) {
      throw new Error(
        `cannot update verified_contract address=0x${databaseColumns.contractDeployment.address.toString("hex")} chainId=${databaseColumns.contractDeployment.chain_id}\n${e}`,
      );
    }
  }

  async insertOrUpdateVerification(
    verification: VerificationExport,
    poolClient: PoolClient,
  ): Promise<{
    type: "update" | "insert";
    verifiedContractId: Tables.VerifiedContract["id"];
    oldVerifiedContractId?: Tables.VerifiedContract["id"];
  }> {
    this.validateVerificationBeforeStoring(verification);

    await this.init();

    const databaseColumns =
      await DatabaseUtil.getDatabaseColumnsFromVerification(verification);

    // Get all the verified contracts existing in the DatabaseUtil for these exact onchain bytecodes.
    const existingVerifiedContractResult =
      await this.database.getVerifiedContractByChainAndAddress(
        verification.chainId,
        bytesFromString(verification.address)!,
        poolClient,
      );

    if (existingVerifiedContractResult.rowCount === 0) {
      return {
        type: "insert",
        verifiedContractId: await this.insertNewVerifiedContract(
          databaseColumns,
          poolClient,
        ),
      };
    } else {
      return {
        type: "update",
        verifiedContractId: await this.updateExistingVerifiedContract(
          databaseColumns,
          poolClient,
        ),
        oldVerifiedContractId: existingVerifiedContractResult.rows[0].id,
      };
    }
  }

  async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
