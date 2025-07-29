import { VerificationExport } from "@ethereum-sourcify/lib-sourcify";
import { PoolClient } from "pg";
import {
  bytesFromString,
  getDatabaseColumnsFromVerification,
} from "../../../../services/utils/database-util";

export type CustomReplaceMethod = (
  poolClient: PoolClient,
  verification: VerificationExport,
) => Promise<void>;

export const replaceCreationInformation: CustomReplaceMethod = async (
  poolClient: PoolClient,
  verification: VerificationExport,
) => {
  if (
    verification.status.creationMatch !== "perfect" &&
    verification.status.creationMatch !== "partial"
  ) {
    throw new Error(
      "Creation match is null, cannot replace creation information",
    );
  }

  // Get database columns from verification
  const databaseColumns =
    await getDatabaseColumnsFromVerification(verification);

  // Get existing verified contract to find deployment_id
  const existingVerifiedContractQuery = `
    SELECT vc.id, vc.deployment_id, cd.chain_id, cd.address, cd.contract_id
    FROM verified_contracts vc
    JOIN contract_deployments cd ON cd.id = vc.deployment_id
    LEFT JOIN sourcify_matches sm ON sm.verified_contract_id = vc.id
    WHERE cd.chain_id = $1 AND cd.address = $2
    LIMIT 1
  `;

  const existingResult = await poolClient.query(existingVerifiedContractQuery, [
    verification.chainId.toString(),
    bytesFromString(verification.address),
  ]);

  if (existingResult.rows.length === 0) {
    throw new Error(
      `No existing verified contract found for address ${verification.address} on chain ${verification.chainId}`,
    );
  }

  const existingVerifiedContract = existingResult.rows[0];
  const deploymentId = existingVerifiedContract.deployment_id;

  // Insert new creation code if it exists
  let newCreationCodeHash: Buffer | undefined;
  if (databaseColumns.onchainCreationCode) {
    const creationCodeInsertResult = await poolClient.query(
      `INSERT INTO code (code_hash, code, code_hash_keccak) 
       VALUES (digest($1::bytea, 'sha256'), $1::bytea, $2) 
       ON CONFLICT (code_hash) DO NOTHING 
       RETURNING code_hash`,
      [
        databaseColumns.onchainCreationCode.bytecode,
        databaseColumns.onchainCreationCode.bytecode_hash_keccak,
      ],
    );

    if (creationCodeInsertResult.rows.length === 0) {
      // Code already exists, get the hash
      const existingCodeResult = await poolClient.query(
        `SELECT code_hash FROM code WHERE code_hash = digest($1::bytea, 'sha256')`,
        [databaseColumns.onchainCreationCode.bytecode],
      );
      newCreationCodeHash = existingCodeResult.rows[0].code_hash;
    } else {
      newCreationCodeHash = creationCodeInsertResult.rows[0].code_hash;
    }
  }

  // Get current contract's runtime code hash
  const currentContractQuery = `
    SELECT runtime_code_hash FROM contracts WHERE id = $1
  `;
  const currentContractResult = await poolClient.query(currentContractQuery, [
    existingVerifiedContract.contract_id,
  ]);
  const runtimeCodeHash = currentContractResult.rows[0].runtime_code_hash;

  // Insert new contract with new creation code and existing runtime code
  const newContractInsertResult = await poolClient.query(
    `INSERT INTO contracts (creation_code_hash, runtime_code_hash) 
     VALUES ($1, $2) 
     ON CONFLICT (creation_code_hash, runtime_code_hash) DO NOTHING 
     RETURNING id`,
    [newCreationCodeHash, runtimeCodeHash],
  );

  let newContractId: string;
  if (newContractInsertResult.rows.length === 0) {
    // Contract already exists, get the id
    const existingContractResult = await poolClient.query(
      `SELECT id FROM contracts WHERE creation_code_hash = $1 AND runtime_code_hash = $2`,
      [newCreationCodeHash, runtimeCodeHash],
    );
    newContractId = existingContractResult.rows[0].id;
  } else {
    newContractId = newContractInsertResult.rows[0].id;
  }

  // Update contract deployment with new creation fields and new contract_id
  await poolClient.query(
    `UPDATE contract_deployments 
     SET 
       transaction_hash = $2,
       block_number = $3,
       transaction_index = $4,
       deployer = $5,
       contract_id = $6
     WHERE id = $1`,
    [
      deploymentId,
      databaseColumns.contractDeployment.transaction_hash,
      databaseColumns.contractDeployment.block_number,
      databaseColumns.contractDeployment.transaction_index,
      databaseColumns.contractDeployment.deployer,
      newContractId,
    ],
  );

  // Update verified_contracts with creation match data
  await poolClient.query(
    `UPDATE verified_contracts 
     SET 
       creation_match = $2,
       creation_values = $3,
       creation_transformations = $4,
       creation_metadata_match = $5
     WHERE id = $1`,
    [
      existingVerifiedContract.id,
      databaseColumns.verifiedContract.creation_match,
      databaseColumns.verifiedContract.creation_values,
      databaseColumns.verifiedContract.creation_transformations
        ? JSON.stringify(
            databaseColumns.verifiedContract.creation_transformations,
          )
        : null,
      databaseColumns.verifiedContract.creation_metadata_match,
    ],
  );

  // Update sourcify_matches with creation_match
  const creationMatchStatus = verification.status.creationMatch;
  await poolClient.query(
    `UPDATE sourcify_matches 
     SET creation_match = $2
     WHERE verified_contract_id = $1`,
    [existingVerifiedContract.id, creationMatchStatus],
  );
};

export const REPLACE_METHODS: Record<string, CustomReplaceMethod> = {
  "replace-creation-information": replaceCreationInformation,
};
