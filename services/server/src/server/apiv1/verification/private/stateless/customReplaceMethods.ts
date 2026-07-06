import type {
  ImmutableReferences,
  VerificationExport,
} from "@ethereum-sourcify/lib-sourcify";
import {
  bytesFromString,
  getDatabaseColumnsFromVerification,
} from "../../../../services/utils/database-util";
import type { SourcifyDatabaseService } from "../../../../services/storageServices/SourcifyDatabaseService";
import { BadRequestError } from "../../../../../common/errors";
import logger from "../../../../../common/logger";

/**
 * Result of a custom replace method:
 * - `undefined` when the replacement was applied
 * - `{ reason, replaced }` to report an explicit outcome with a reason
 */
export type CustomReplaceResult = void | { reason: string; replaced: boolean };

export type CustomReplaceMethod = (
  sourcifyDatabaseService: SourcifyDatabaseService,
  verification: VerificationExport,
) => Promise<CustomReplaceResult>;

export const replaceCreationInformation: CustomReplaceMethod = async (
  sourcifyDatabaseService: SourcifyDatabaseService,
  verification: VerificationExport,
) => {
  const verificationStatus = verification.status;
  const creationMatch =
    verificationStatus.creationMatch === "perfect" ||
    verificationStatus.creationMatch === "partial";

  const runtimeMatch =
    verificationStatus.runtimeMatch === "perfect" ||
    verificationStatus.runtimeMatch === "partial";

  // If the new verification leads to a non-match, we can't replace the contract
  if (!runtimeMatch && !creationMatch) {
    throw new BadRequestError(
      "Failed to match the contract with the new verification",
    );
  }

  // Get database columns from verification
  const databaseColumns =
    await getDatabaseColumnsFromVerification(verification);

  await sourcifyDatabaseService.withTransaction(async (poolClient) => {
    if (!databaseColumns.onchainCreationCode) {
      throw new Error(
        "No onchain creation code, cannot replace creation information",
      );
    }
    // Get existing verified contract to find deployment_id
    const existingVerifiedContractQuery = `
          SELECT vc.id, vc.deployment_id, cd.chain_id, cd.address, cd.contract_id
          FROM verified_contracts vc
          JOIN contract_deployments cd ON cd.id = vc.deployment_id
          INNER JOIN sourcify_matches sm ON sm.verified_contract_id = vc.id
          WHERE cd.chain_id = $1 AND cd.address = $2
          LIMIT 1
        `;

    const existingResult = await poolClient.query(
      existingVerifiedContractQuery,
      [verification.chainId.toString(), bytesFromString(verification.address)],
    );

    if (existingResult.rows.length === 0) {
      throw new Error(
        `No existing verified contract found for address ${verification.address} on chain ${verification.chainId}`,
      );
    }

    const existingVerifiedContract = existingResult.rows[0];
    const deploymentId = existingVerifiedContract.deployment_id;

    const recompiledCreationCodeInsertResult =
      await sourcifyDatabaseService.database.insertCode(poolClient, {
        bytecode: databaseColumns.onchainCreationCode.bytecode,
        bytecode_hash_keccak:
          databaseColumns.onchainCreationCode?.bytecode_hash_keccak,
      });
    // Insert new creation code if it exists
    const newCreationCodeHash =
      recompiledCreationCodeInsertResult.rows[0].bytecode_hash;

    // Get current contract's runtime code hash
    const currentContractQuery = `SELECT runtime_code_hash FROM contracts WHERE id = $1`;
    const currentContractResult = await poolClient.query(currentContractQuery, [
      existingVerifiedContract.contract_id,
    ]);
    const runtimeCodeHash = currentContractResult.rows[0].runtime_code_hash;

    // Insert new contract with new creation code hash
    const contractInsertResult =
      await sourcifyDatabaseService.database.insertContract(poolClient, {
        creation_bytecode_hash: newCreationCodeHash,
        runtime_bytecode_hash: runtimeCodeHash,
      });
    const newContractId = contractInsertResult.rows[0].id;

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
  });
};

export const replaceMetadata: CustomReplaceMethod = async (
  sourcifyDatabaseService: SourcifyDatabaseService,
  verification: VerificationExport,
) => {
  const existingSourcifyMatch =
    await sourcifyDatabaseService.database.getSourcifyMatchByChainAddressWithProperties(
      verification.chainId,
      bytesFromString(verification.address),
      ["id"],
    );
  if (existingSourcifyMatch.rows.length === 0) {
    throw new Error(
      `No existing verified contract found for address ${verification.address} on chain ${verification.chainId}`,
    );
  }

  const matchId = existingSourcifyMatch.rows[0].id;

  await sourcifyDatabaseService.database.pool.query(
    `UPDATE sourcify_matches 
       SET 
         metadata = $2
       WHERE id = $1`,
    [matchId, verification.compilation.metadata],
  );
};

/**
 * Backfills the `immutableReferences` of an already-verified Vyper contract by
 * writing the references recomputed during this re-verification into the
 * existing `compiled_contracts.runtime_code_artifacts` JSONB.
 *
 * Vyper `immutableReferences` were historically never persisted (always stored
 * as `null`), even for contracts that genuinely have immutables. This method is
 * used together with `forceCompilation: true` so the references are recovered
 * from a fresh compile (required for legacy `< 0.3.10` contracts whose immutable
 * size is derived from the compiler IR). See issue #2827.
 *
 * Solidity is intentionally not supported: its `immutableReferences` have always
 * been persisted, so this method throws for any non-Vyper contract.
 *
 * Only writes when there are references to write; contracts without immutables
 * are left untouched (stays `null`), matching how new verifications store them.
 *
 * Returns `undefined` when the references were written, or
 * `{ reason, replaced: true/false }` otherwise.
 */
export const replaceVyperImmutableReferences: CustomReplaceMethod = async (
  sourcifyDatabaseService: SourcifyDatabaseService,
  verification: VerificationExport,
) => {
  if (verification.compilation.language !== "Vyper") {
    throw new BadRequestError(
      `replace-vyper-immutable-references only supports Vyper contracts, got ${verification.compilation.language}`,
    );
  }

  // Extract immutableReferences from the recompiled contract. The getter can
  // throw, so it is wrapped in try/catch.
  let immutableReferences: ImmutableReferences | null = null;
  try {
    immutableReferences = verification.compilation.immutableReferences || null;
  } catch {
    // The immutableReferences getter can throw; leave it null in that case.
  }

  // Nothing to backfill (no immutables): keep the row as-is.
  if (!immutableReferences || Object.keys(immutableReferences).length === 0) {
    const reason = "Contract has no immutableReferences to backfill";
    logger.info(reason, {
      chainId: verification.chainId,
      address: verification.address,
    });
    return { reason, replaced: false };
  }

  // Find the compiled_contracts row backing this verified contract.
  const existingVerifiedContractQuery = `
        SELECT vc.compilation_id
        FROM verified_contracts vc
        JOIN contract_deployments cd ON cd.id = vc.deployment_id
        INNER JOIN sourcify_matches sm ON sm.verified_contract_id = vc.id
        WHERE cd.chain_id = $1 AND cd.address = $2
      `;
  const existingResult = await sourcifyDatabaseService.database.pool.query(
    existingVerifiedContractQuery,
    [verification.chainId.toString(), bytesFromString(verification.address)],
  );

  if (existingResult.rows.length === 0) {
    throw new Error(
      `No existing verified contract found for address ${verification.address} on chain ${verification.chainId}`,
    );
  }

  // If multiple verified contracts point to the same deployment we can't tell
  // which compilation to backfill, so refuse rather than guess.
  if (existingResult.rows.length > 1) {
    throw new Error(
      `Multiple verified contracts found for address ${verification.address} on chain ${verification.chainId}; cannot safely backfill immutableReferences`,
    );
  }

  const compilationId = existingResult.rows[0].compilation_id;

  // Update only the immutableReferences key to avoid clobbering the other
  // runtime_code_artifacts (sourceMap, linkReferences, cborAuxdata). Updating
  // the shared compiled_contracts row backfills every verified contract that
  // reuses this compilation.
  await sourcifyDatabaseService.database.pool.query(
    `UPDATE compiled_contracts
       SET runtime_code_artifacts = jsonb_set(
         runtime_code_artifacts, '{immutableReferences}', $2::jsonb, true)
       WHERE id = $1`,
    [compilationId, JSON.stringify(immutableReferences)],
  );
};

export const REPLACE_METHODS: Record<string, CustomReplaceMethod> = {
  "replace-creation-information": replaceCreationInformation,
  "replace-metadata": replaceMetadata,
  "replace-vyper-immutable-references": replaceVyperImmutableReferences,
};
