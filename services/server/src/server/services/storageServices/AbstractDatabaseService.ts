import {
  Match,
  CheckedContract,
  Transformation,
} from "@ethereum-sourcify/lib-sourcify";
import { keccak256 } from "ethers";
import * as Database from "../utils/database-util";
import {
  bytesFromString,
  normalizeRecompiledBytecodes,
} from "../utils/database-util";
import { Pool } from "pg";

export default abstract class AbstractDatabaseService {
  abstract init(): Promise<boolean>;
  abstract databasePool: Pool;
  abstract databaseName: string;

  validateBeforeStoring(
    recompiledContract: CheckedContract,
    match: Match
  ): boolean {
    if (
      recompiledContract.runtimeBytecode === undefined ||
      recompiledContract.creationBytecode === undefined ||
      match.onchainRuntimeBytecode === undefined ||
      match.onchainCreationBytecode === undefined
    ) {
      throw new Error(
        `can only store contracts with both runtimeBytecode and creationBytecode address=${match.address} chainId=${match.chainId}`
      );
    }
    if (match.creatorTxHash === undefined) {
      throw new Error(
        `can only store matches with creatorTxHash address=${match.address} chainId=${match.chainId}`
      );
    }
    return true;
  }

  getKeccak256Bytecodes(recompiledContract: CheckedContract, match: Match) {
    return {
      keccak256OnchainCreationBytecode: match.onchainCreationBytecode
        ? keccak256(bytesFromString(match.onchainCreationBytecode)!)
        : undefined,
      keccak256OnchainRuntimeBytecode: keccak256(
        bytesFromString(match.onchainRuntimeBytecode!)!
      ),
      keccak256RecompiledCreationBytecode:
        recompiledContract.normalizedCreationBytecode
          ? keccak256(
              bytesFromString(recompiledContract.normalizedCreationBytecode)!
            ) // eslint-disable-line indent
          : undefined,
      keccak256RecompiledRuntimeBytecode: keccak256(
        bytesFromString(recompiledContract.normalizedRuntimeBytecode!)!
      ),
    };
  }

  async getDatabaseColumns(
    recompiledContract: CheckedContract,
    match: Match
  ): Promise<Database.DatabaseColumns> {
    const {
      keccak256OnchainCreationBytecode,
      keccak256OnchainRuntimeBytecode,
      keccak256RecompiledCreationBytecode,
      keccak256RecompiledRuntimeBytecode,
    } = this.getKeccak256Bytecodes(recompiledContract, match);

    const {
      runtimeTransformations,
      runtimeTransformationValues,
      creationTransformations,
      creationTransformationValues,
    } = match;
    const compilationTargetPath = Object.keys(
      recompiledContract.metadata.settings.compilationTarget
    )[0];
    const compilationTargetName = Object.values(
      recompiledContract.metadata.settings.compilationTarget
    )[0];
    const language = "solidity";
    const compilerOutput =
      recompiledContract.compilerOutput?.contracts[
        recompiledContract.compiledPath
      ][recompiledContract.name];

    if (!(await recompiledContract.generateCborAuxdataPositions())) {
      throw new Error(
        `cannot generate contract artifacts address=${match.address} chainId=${match.chainId}`
      );
    }

    const compilationArtifacts = {
      abi: compilerOutput?.abi || {},
      userdoc: compilerOutput?.userdoc || {},
      devdoc: compilerOutput?.devdoc || {},
      storageLayout: compilerOutput?.storageLayout || {},
    };
    const creationCodeArtifacts = {
      sourceMap: compilerOutput?.evm.bytecode.sourceMap || "",
      linkReferences: compilerOutput?.evm.bytecode.linkReferences || {},
      cborAuxdata: recompiledContract?.creationBytecodeCborAuxdata,
    };
    const runtimeCodeArtifacts = {
      sourceMap: compilerOutput?.evm.deployedBytecode?.sourceMap || "",
      linkReferences:
        compilerOutput?.evm.deployedBytecode?.linkReferences || {},
      immutableReferences:
        compilerOutput?.evm.deployedBytecode?.immutableReferences || {},
      cborAuxdata: recompiledContract?.runtimeBytecodeCborAuxdata,
    };

    const runtimeMatch =
      match.runtimeMatch === "perfect" || match.runtimeMatch === "partial";
    const creationMatch =
      match.creationMatch === "perfect" || match.creationMatch === "partial";

    return {
      bytecodeHashes: {
        recompiledCreation: bytesFromString(keccak256OnchainCreationBytecode),
        recompiledRuntime: bytesFromString(keccak256OnchainRuntimeBytecode)!,
        onchainCreation: bytesFromString(keccak256RecompiledCreationBytecode),
        onchainRuntime: bytesFromString(keccak256RecompiledRuntimeBytecode)!,
      },
      compiledContract: {
        language,
        fully_qualified_name: `${compilationTargetPath}:${compilationTargetName}`,
        compilation_artifacts: compilationArtifacts,
        creation_code_artifacts: creationCodeArtifacts,
        runtime_code_artifacts: runtimeCodeArtifacts,
      },
      verifiedContract: {
        runtime_transformations: runtimeTransformations,
        creation_transformations: creationTransformations,
        runtime_transformation_values: runtimeTransformationValues,
        creation_transformation_values: creationTransformationValues,
        runtime_match: runtimeMatch,
        creation_match: creationMatch,
      },
    };
  }

  async insertNewVerifiedContract(
    recompiledContract: CheckedContract,
    match: Match,
    databaseColumns: Database.DatabaseColumns
  ): Promise<string> {
    try {
      // Add recompiled bytecodes
      if (databaseColumns.bytecodeHashes.recompiledCreation) {
        await Database.insertCode(this.databasePool, {
          bytecode_hash: databaseColumns.bytecodeHashes.recompiledCreation,
          bytecode: bytesFromString(
            recompiledContract.normalizedCreationBytecode
          )!,
        });
      }
      await Database.insertCode(this.databasePool, {
        bytecode_hash: databaseColumns.bytecodeHashes.recompiledRuntime,
        bytecode: bytesFromString(
          recompiledContract.normalizedRuntimeBytecode
        )!,
      });

      // Add onchain bytecodes
      if (databaseColumns.bytecodeHashes.onchainCreation) {
        await Database.insertCode(this.databasePool, {
          bytecode_hash: databaseColumns.bytecodeHashes.onchainCreation,
          bytecode: bytesFromString(match.onchainCreationBytecode)!,
        });
      }
      await Database.insertCode(this.databasePool, {
        bytecode_hash: databaseColumns.bytecodeHashes.onchainRuntime,
        bytecode: bytesFromString(match.onchainRuntimeBytecode)!,
      });

      // Add the onchain contract in contracts
      const contractInsertResult = await Database.insertContract(
        this.databasePool,
        {
          creation_bytecode_hash:
            databaseColumns.bytecodeHashes.onchainCreation,
          runtime_bytecode_hash: databaseColumns.bytecodeHashes.onchainRuntime,
        }
      );

      // add the onchain contract in contract_deployments
      const contractDeploymentInsertResult =
        await Database.insertContractDeployment(this.databasePool, {
          chain_id: match.chainId,
          address: bytesFromString(match.address)!,
          transaction_hash: bytesFromString(match.creatorTxHash)!,
          contract_id: contractInsertResult.rows[0].id,
          block_number: match.blockNumber,
          txindex: match.txIndex,
          deployer: bytesFromString(match.deployer),
        });

      // insert new recompiled contract
      const compiledContractsInsertResult =
        await Database.insertCompiledContract(this.databasePool, {
          compiler: "solc",
          version: recompiledContract.compilerVersion,
          language: databaseColumns.compiledContract.language!,
          name: recompiledContract.name,
          fully_qualified_name:
            databaseColumns.compiledContract.fully_qualified_name!,
          compilation_artifacts:
            databaseColumns.compiledContract.compilation_artifacts!,
          sources: recompiledContract.solidity,
          compiler_settings: recompiledContract.metadata.settings,
          creation_code_hash: databaseColumns.bytecodeHashes.recompiledCreation,
          runtime_code_hash: databaseColumns.bytecodeHashes.recompiledRuntime,
          creation_code_artifacts:
            databaseColumns.compiledContract.creation_code_artifacts!,
          runtime_code_artifacts:
            databaseColumns.compiledContract.runtime_code_artifacts!,
        });

      // insert new recompiled contract with newly added contract and compiledContract
      const verifiedContractInsertResult =
        await Database.insertVerifiedContract(this.databasePool, {
          compilation_id: compiledContractsInsertResult.rows[0].id,
          deployment_id: contractDeploymentInsertResult.rows[0].id,
          creation_transformations:
            databaseColumns.verifiedContract.creation_transformations,
          creation_transformation_values:
            databaseColumns.verifiedContract.creation_transformation_values ||
            {},
          runtime_transformations:
            databaseColumns.verifiedContract.runtime_transformations,
          runtime_transformation_values:
            databaseColumns.verifiedContract.runtime_transformation_values ||
            {},
          runtime_match: databaseColumns.verifiedContract.runtime_match!,
          creation_match: databaseColumns.verifiedContract.creation_match!,
        });
      return verifiedContractInsertResult.rows[0].id;
    } catch (e) {
      throw new Error(
        `cannot insert verified_contract address=${match.address} chainId=${match.chainId}\n${e}`
      );
    }
  }

  async updateExistingVerifiedContract(
    existingVerifiedContractResult: Database.Tables.VerifiedContract[],
    recompiledContract: CheckedContract,
    match: Match,
    databaseColumns: Database.DatabaseColumns
  ): Promise<string | false> {
    // Until the Sourcify will decide a standard process to update:
    // if we have a "better match" always insert
    // "better match" = creation_transformations or runtime_transformations is better

    let needRuntimeMatchUpdate = false;
    let needCreationMatchUpdate = false;

    const existingCompiledContractIds: string[] = [];

    existingVerifiedContractResult.forEach((existingVerifiedContract) => {
      existingCompiledContractIds.push(existingVerifiedContract.compilation_id);
      const hasRuntimeAuxdataTransformation =
        existingVerifiedContract.runtime_transformations!.some(
          (trans: Transformation) => trans.reason === "auxdata"
        );
      const hasCreationAuxdataTransformation =
        existingVerifiedContract.creation_transformations!.some(
          (trans: Transformation) => trans.reason === "auxdata"
        );

      if (
        (hasRuntimeAuxdataTransformation && match.runtimeMatch === "perfect") ||
        (existingVerifiedContract.runtime_match === false &&
          (match.runtimeMatch === "perfect" ||
            match.runtimeMatch === "partial"))
      ) {
        needRuntimeMatchUpdate = true;
      }

      if (
        (hasCreationAuxdataTransformation &&
          match.creationMatch === "perfect") ||
        (existingVerifiedContract.creation_match === false &&
          (match.creationMatch === "perfect" ||
            match.creationMatch === "partial"))
      ) {
        needCreationMatchUpdate = true;
      }
    });

    if (!needRuntimeMatchUpdate && !needCreationMatchUpdate) {
      return false;
    }
    try {
      // Add recompiled bytecodes
      if (databaseColumns.bytecodeHashes.recompiledCreation) {
        await Database.insertCode(this.databasePool, {
          bytecode_hash: databaseColumns.bytecodeHashes.recompiledCreation,
          bytecode: bytesFromString(
            recompiledContract.normalizedCreationBytecode
          )!,
        });
      }
      await Database.insertCode(this.databasePool, {
        bytecode_hash: databaseColumns.bytecodeHashes.recompiledRuntime,
        bytecode: bytesFromString(
          recompiledContract.normalizedRuntimeBytecode
        )!,
      });

      // insert new recompiled contract
      const compiledContractsInsertResult =
        await Database.insertCompiledContract(this.databasePool, {
          compiler: recompiledContract.compiledPath,
          version: recompiledContract.compilerVersion,
          language: databaseColumns.compiledContract.language!,
          name: recompiledContract.name,
          fully_qualified_name:
            databaseColumns.compiledContract.fully_qualified_name!,
          compilation_artifacts:
            databaseColumns.compiledContract.compilation_artifacts!,
          sources: recompiledContract.solidity,
          compiler_settings: recompiledContract.metadata.settings,
          creation_code_hash: databaseColumns.bytecodeHashes.recompiledCreation,
          runtime_code_hash: databaseColumns.bytecodeHashes.recompiledRuntime,
          creation_code_artifacts:
            databaseColumns.compiledContract.creation_code_artifacts!,
          runtime_code_artifacts:
            databaseColumns.compiledContract.runtime_code_artifacts!,
        });

      // Check if we are trying to insert a compiled contract that already exists
      // It could happen because of the check "needRuntimeMatchUpdate || needCreationMatchUpdate"
      // When the Sourcify will decide a standard process to update this check will be removed
      if (
        existingCompiledContractIds.includes(
          compiledContractsInsertResult.rows[0].id
        )
      ) {
        return false;
      }

      // update verified contract with the newly added recompiled contract
      const verifiedContractInsertResult =
        await Database.insertVerifiedContract(this.databasePool, {
          compilation_id: compiledContractsInsertResult.rows[0].id,
          deployment_id: existingVerifiedContractResult[0].deployment_id,
          creation_transformations:
            databaseColumns.verifiedContract.creation_transformations,
          creation_transformation_values:
            databaseColumns.verifiedContract.creation_transformation_values ||
            {},
          runtime_transformations:
            databaseColumns.verifiedContract.runtime_transformations,
          runtime_transformation_values:
            databaseColumns.verifiedContract.runtime_transformation_values ||
            {},
          runtime_match: databaseColumns.verifiedContract.runtime_match!,
          creation_match: databaseColumns.verifiedContract.creation_match!,
        });

      return verifiedContractInsertResult.rows[0].id;
    } catch (e) {
      throw new Error(
        `cannot update verified_contract address=${match.address} chainId=${match.chainId}\n${e}`
      );
    }
  }

  async insertOrUpdateVerifiedContract(
    recompiledContract: CheckedContract,
    match: Match
  ): Promise<{
    type: "update" | "insert";
    verifiedContractId: string | false;
  }> {
    this.validateBeforeStoring(recompiledContract, match);

    await this.init();

    // Normalize both creation and runtime recompiled bytecodes before storing them to the database
    normalizeRecompiledBytecodes(recompiledContract, match);

    const databaseColumns = await this.getDatabaseColumns(
      recompiledContract,
      match
    );

    // Get all the verified contracts existing in the Database for these exact onchain bytecodes.
    const existingVerifiedContractResult =
      await Database.getVerifiedContractByChainAndAddress(
        this.databasePool,
        parseInt(match.chainId),
        bytesFromString(match.address)
      );

    if (existingVerifiedContractResult.rowCount === 0) {
      return {
        type: "insert",
        verifiedContractId: await this.insertNewVerifiedContract(
          recompiledContract,
          match,
          databaseColumns
        ),
      };
    } else {
      return {
        type: "update",
        verifiedContractId: await this.updateExistingVerifiedContract(
          existingVerifiedContractResult.rows,
          recompiledContract,
          match,
          databaseColumns
        ),
      };
    }
  }
}
