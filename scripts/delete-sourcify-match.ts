#!/usr/bin/env tsx
/**
 * Script to delete all verified_contracts and their related data for a given chain_id and address.
 *
 * Usage:
 *   npx tsx scripts/delete-sourcify-match.ts <chain_id> <contract_address>
 *
 * Example:
 *   npx tsx scripts/delete-sourcify-match.ts 1 0x1234567890123456789012345678901234567890
 *
 * This script will:
 * 1. Find ALL verified_contracts for the given chain_id and contract_address
 * 2. Delete related verification_jobs and verification_jobs_ephemeral (if tables exist)
 * 3. For each verified_contract, delete its sourcify_match (if table exists and match exists)
 * 4. Delete all verified_contracts
 * 5. Get code hashes from compiled_contracts before deleting
 * 6. Delete compiled_contracts_sources (if source not referenced by other compiled_contracts)
 * 7. Delete compiled_contracts_signatures (if signature not referenced by other compiled_contracts)
 * 8. Delete the compiled_contract (if not referenced by other verified_contracts)
 * 9. Get code hashes from contracts before potentially deleting
 * 10. Delete the contract_deployment (if not referenced by other verified_contracts)
 * 11. Delete the contract (if not referenced by other contract_deployments)
 * 12. Delete orphaned sources, signatures, and code entries
 */

import { Pool, PoolClient } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from scripts/.env or services/server/.env (fallback)
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "../services/server/.env") });

interface VerifiedContractInfo {
  verified_contract_id: string;
  deployment_id: string;
  compilation_id: string;
  contract_id: string;
}

interface DeleteStats {
  verifiedContractsFound: number;
  sourcifyMatchesDeleted: number;
  verifiedContractsDeleted: number;
  verificationJobsDeleted: number;
  contractDeploymentsDeleted: number;
  compiledContractsDeleted: number;
  contractsDeleted: number;
  sourcesDeleted: number;
  signaturesDeleted: number;
  codeEntriesDeleted: number;
  compiledContractsSourcesDeleted: number;
  compiledContractsSignaturesDeleted: number;
}

async function deleteCompiledContractSources(
  client: PoolClient,
  compilationId: string,
  stats: DeleteStats,
): Promise<void> {
  // Get all source_hashes for this compilation
  const sourcesResult = await client.query(
    `SELECT source_hash FROM compiled_contracts_sources WHERE compilation_id = $1`,
    [compilationId],
  );

  for (const row of sourcesResult.rows) {
    const sourceHash = row.source_hash;

    // Check if this source is referenced by other compiled_contracts_sources
    const otherSourceRefsResult = await client.query(
      `SELECT COUNT(*) as count FROM compiled_contracts_sources WHERE source_hash = $1 AND compilation_id != $2`,
      [sourceHash, compilationId],
    );

    const canDeleteSource = parseInt(otherSourceRefsResult.rows[0].count) === 0;

    // Delete the compiled_contracts_sources entry
    await client.query(
      `DELETE FROM compiled_contracts_sources WHERE compilation_id = $1 AND source_hash = $2`,
      [compilationId, sourceHash],
    );
    stats.compiledContractsSourcesDeleted++;

    // Delete the source if not referenced elsewhere
    if (canDeleteSource) {
      await client.query(`DELETE FROM sources WHERE source_hash = $1`, [
        sourceHash,
      ]);
      stats.sourcesDeleted++;
    }
  }
}

async function deleteCompiledContractSignatures(
  client: PoolClient,
  compilationId: string,
  stats: DeleteStats,
): Promise<void> {
  // Get all signature_hash_32 for this compilation
  const signaturesResult = await client.query(
    `SELECT signature_hash_32 FROM compiled_contracts_signatures WHERE compilation_id = $1`,
    [compilationId],
  );

  for (const row of signaturesResult.rows) {
    const signatureHash = row.signature_hash_32;

    // Check if this signature is referenced by other compiled_contracts_signatures
    const otherSigRefsResult = await client.query(
      `SELECT COUNT(*) as count FROM compiled_contracts_signatures WHERE signature_hash_32 = $1 AND compilation_id != $2`,
      [signatureHash, compilationId],
    );

    const canDeleteSignature =
      parseInt(otherSigRefsResult.rows[0].count) === 0;

    // Delete the compiled_contracts_signatures entry
    await client.query(
      `DELETE FROM compiled_contracts_signatures WHERE compilation_id = $1 AND signature_hash_32 = $2`,
      [compilationId, signatureHash],
    );
    stats.compiledContractsSignaturesDeleted++;

    // Delete the signature if not referenced elsewhere
    if (canDeleteSignature) {
      await client.query(
        `DELETE FROM signatures WHERE signature_hash_32 = $1`,
        [signatureHash],
      );
      stats.signaturesDeleted++;
    }
  }
}

async function deleteCodeIfOrphaned(
  client: PoolClient,
  codeHash: Buffer | null,
  stats: DeleteStats,
): Promise<void> {
  if (!codeHash) return;

  // Check if this code is referenced by other compiled_contracts
  const otherCompiledContractsResult = await client.query(
    `SELECT COUNT(*) as count FROM compiled_contracts
     WHERE creation_code_hash = $1 OR runtime_code_hash = $1`,
    [codeHash],
  );

  // Check if this code is referenced by other contracts
  const otherContractsResult = await client.query(
    `SELECT COUNT(*) as count FROM contracts
     WHERE creation_code_hash = $1 OR runtime_code_hash = $1`,
    [codeHash],
  );

  const canDeleteCode =
    parseInt(otherCompiledContractsResult.rows[0].count) === 0 &&
    parseInt(otherContractsResult.rows[0].count) === 0;

  if (canDeleteCode) {
    await client.query(`DELETE FROM code WHERE code_hash = $1`, [codeHash]);
    stats.codeEntriesDeleted++;
  }
}

async function deleteVerifiedContracts(
  chainId: number,
  address: string,
): Promise<DeleteStats> {
  const pool = new Pool({
    host: process.env.SOURCIFY_POSTGRES_HOST || "localhost",
    port: parseInt(process.env.SOURCIFY_POSTGRES_PORT || "5432"),
    database: process.env.SOURCIFY_POSTGRES_DB || "sourcify",
    user: process.env.SOURCIFY_POSTGRES_USER || "sourcify",
    password: process.env.SOURCIFY_POSTGRES_PASSWORD,
  });

  const stats: DeleteStats = {
    verifiedContractsFound: 0,
    sourcifyMatchesDeleted: 0,
    verifiedContractsDeleted: 0,
    verificationJobsDeleted: 0,
    contractDeploymentsDeleted: 0,
    compiledContractsDeleted: 0,
    contractsDeleted: 0,
    sourcesDeleted: 0,
    signaturesDeleted: 0,
    codeEntriesDeleted: 0,
    compiledContractsSourcesDeleted: 0,
    compiledContractsSignaturesDeleted: 0,
  };

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Normalize address to bytea format (remove 0x prefix if present)
    const normalizedAddress = address.toLowerCase().startsWith("0x")
      ? address.substring(2)
      : address;
    const addressBytes = Buffer.from(normalizedAddress, "hex");

    console.log(
      `\n🔍 Looking for verified_contracts with chain_id=${chainId} and address=0x${normalizedAddress}...\n`,
    );

    // 1. Find ALL verified_contracts for this chain_id and address
    const verifiedContractsResult = await client.query<VerifiedContractInfo>(
      `
      SELECT
        vc.id as verified_contract_id,
        vc.deployment_id,
        vc.compilation_id,
        cd.contract_id
      FROM verified_contracts vc
      JOIN contract_deployments cd ON cd.id = vc.deployment_id
      WHERE cd.chain_id = $1 AND cd.address = $2
      `,
      [chainId, addressBytes],
    );

    if (verifiedContractsResult.rows.length === 0) {
      throw new Error(
        `No verified_contracts found for chain_id=${chainId} and address=0x${normalizedAddress}`,
      );
    }

    stats.verifiedContractsFound = verifiedContractsResult.rows.length;
    console.log(`✓ Found ${stats.verifiedContractsFound} verified_contract(s)\n`);

    // Track unique IDs to avoid redundant deletions and checks
    const verifiedContractIds = new Set<string>();
    const compilationIds = new Set<string>();
    const deploymentIds = new Set<string>();
    const contractIds = new Set<string>();

    // Display all verified_contracts found
    verifiedContractsResult.rows.forEach((vc, index) => {
      console.log(`Verified Contract ${index + 1}:`);
      console.log(`  - verified_contract_id: ${vc.verified_contract_id}`);
      console.log(`  - deployment_id: ${vc.deployment_id}`);
      console.log(`  - compilation_id: ${vc.compilation_id}`);
      console.log(`  - contract_id: ${vc.contract_id}\n`);

      verifiedContractIds.add(vc.verified_contract_id);
      compilationIds.add(vc.compilation_id);
      deploymentIds.add(vc.deployment_id);
      contractIds.add(vc.contract_id);
    });

    // 2. Delete verification_jobs for all verified_contracts (if table exists)
    const tableExistsResult = await client.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'verification_jobs'
      )`,
    );
    const verificationJobsTableExists = tableExistsResult.rows[0].exists;

    if (verificationJobsTableExists) {
      for (const verifiedContractId of verifiedContractIds) {
        // Get all verification_jobs ids for this verified_contract
        const jobsResult = await client.query(
          `SELECT id FROM verification_jobs WHERE verified_contract_id = $1`,
          [verifiedContractId],
        );

        // Delete from verification_jobs_ephemeral first (foreign key constraint)
        for (const job of jobsResult.rows) {
          await client.query(
            `DELETE FROM verification_jobs_ephemeral WHERE id = $1`,
            [job.id],
          );
        }

        // Then delete from verification_jobs
        const deleteJobsResult = await client.query(
          `DELETE FROM verification_jobs WHERE verified_contract_id = $1`,
          [verifiedContractId],
        );
        stats.verificationJobsDeleted += deleteJobsResult.rowCount || 0;
      }
      console.log(`✓ Deleted ${stats.verificationJobsDeleted} verification_job(s) and ephemeral data`);
    } else {
      console.log(`⊘ Skipped verification_jobs (table does not exist)`);
    }

    // 3. Delete sourcify_matches for all verified_contracts (if table exists)
    const sourcifyMatchesTableExistsResult = await client.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'sourcify_matches'
      )`,
    );
    const sourcifyMatchesTableExists = sourcifyMatchesTableExistsResult.rows[0].exists;

    if (sourcifyMatchesTableExists) {
      // Query sourcify_match_ids for each verified_contract
      for (const verifiedContractId of verifiedContractIds) {
        const sourcifyMatchResult = await client.query(
          `SELECT id FROM sourcify_matches WHERE verified_contract_id = $1`,
          [verifiedContractId],
        );

        if (sourcifyMatchResult.rows.length > 0) {
          for (const match of sourcifyMatchResult.rows) {
            await client.query(`DELETE FROM sourcify_matches WHERE id = $1`, [
              match.id,
            ]);
            stats.sourcifyMatchesDeleted++;
          }
        }
      }
      console.log(`✓ Deleted ${stats.sourcifyMatchesDeleted} sourcify_match(es)`);
    } else {
      console.log(`⊘ Skipped sourcify_matches (table does not exist)`);
    }

    // 4. Delete all verified_contracts
    for (const verifiedContractId of verifiedContractIds) {
      await client.query(`DELETE FROM verified_contracts WHERE id = $1`, [
        verifiedContractId,
      ]);
      stats.verifiedContractsDeleted++;
    }
    console.log(`✓ Deleted ${stats.verifiedContractsDeleted} verified_contract(s)`);

    // 5. Get code hashes from compiled_contracts before deleting
    const compilationCodeHashes = new Map<string, { creation: Buffer | null; runtime: Buffer }>();
    for (const compilationId of compilationIds) {
      const codeHashResult = await client.query(
        `SELECT creation_code_hash, runtime_code_hash FROM compiled_contracts WHERE id = $1`,
        [compilationId],
      );
      if (codeHashResult.rows.length > 0) {
        compilationCodeHashes.set(compilationId, {
          creation: codeHashResult.rows[0].creation_code_hash,
          runtime: codeHashResult.rows[0].runtime_code_hash,
        });
      } else {
        console.error(`⚠️  Warning: compiled_contract with id ${compilationId} not found`);
      }
    }

    // 6. Delete compiled_contracts_sources and orphaned sources
    for (const compilationId of compilationIds) {
      // Check if this compilation is referenced by other verified_contracts
      const otherVerifiedContractsResult = await client.query(
        `SELECT COUNT(*) as count FROM verified_contracts WHERE compilation_id = $1`,
        [compilationId],
      );

      if (parseInt(otherVerifiedContractsResult.rows[0].count) === 0) {
        await deleteCompiledContractSources(client, compilationId, stats);
      }
    }
    console.log(`✓ Deleted ${stats.compiledContractsSourcesDeleted} compiled_contracts_sources`);
    console.log(`✓ Deleted ${stats.sourcesDeleted} source(s) (not referenced elsewhere)`);

    // 7. Delete compiled_contracts_signatures and orphaned signatures
    for (const compilationId of compilationIds) {
      // Check if this compilation is referenced by other verified_contracts
      const otherVerifiedContractsResult = await client.query(
        `SELECT COUNT(*) as count FROM verified_contracts WHERE compilation_id = $1`,
        [compilationId],
      );

      if (parseInt(otherVerifiedContractsResult.rows[0].count) === 0) {
        await deleteCompiledContractSignatures(client, compilationId, stats);
      }
    }
    console.log(`✓ Deleted ${stats.compiledContractsSignaturesDeleted} compiled_contracts_signatures`);
    console.log(`✓ Deleted ${stats.signaturesDeleted} signature(s) (not referenced elsewhere)`);

    // 8. Delete compiled_contracts if not referenced by other verified_contracts
    for (const compilationId of compilationIds) {
      const otherVerifiedContractsResult = await client.query(
        `SELECT COUNT(*) as count FROM verified_contracts WHERE compilation_id = $1`,
        [compilationId],
      );

      if (parseInt(otherVerifiedContractsResult.rows[0].count) === 0) {
        await client.query(`DELETE FROM compiled_contracts WHERE id = $1`, [
          compilationId,
        ]);
        stats.compiledContractsDeleted++;
      }
    }
    console.log(`✓ Deleted ${stats.compiledContractsDeleted} compiled_contract(s)`);

    // 9. Get code hashes from contracts before potentially deleting
    const contractCodeHashes = new Map<string, { creation: Buffer | null; runtime: Buffer }>();
    for (const contractId of contractIds) {
      const contractCodeHashResult = await client.query(
        `SELECT creation_code_hash, runtime_code_hash FROM contracts WHERE id = $1`,
        [contractId],
      );
      if (contractCodeHashResult.rows.length > 0) {
        contractCodeHashes.set(contractId, {
          creation: contractCodeHashResult.rows[0].creation_code_hash,
          runtime: contractCodeHashResult.rows[0].runtime_code_hash,
        });
      } else {
        console.error(`⚠️  Warning: contract with id ${contractId} not found`);
      }
    }

    // 10. Delete contract_deployments if not referenced by other verified_contracts
    for (const deploymentId of deploymentIds) {
      const otherVerifiedContractsResult = await client.query(
        `SELECT COUNT(*) as count FROM verified_contracts WHERE deployment_id = $1`,
        [deploymentId],
      );

      if (parseInt(otherVerifiedContractsResult.rows[0].count) === 0) {
        await client.query(`DELETE FROM contract_deployments WHERE id = $1`, [
          deploymentId,
        ]);
        stats.contractDeploymentsDeleted++;
      }
    }
    console.log(`✓ Deleted ${stats.contractDeploymentsDeleted} contract_deployment(s)`);

    // 11. Delete contracts if not referenced by other contract_deployments
    for (const contractId of contractIds) {
      const otherDeploymentsResult = await client.query(
        `SELECT COUNT(*) as count FROM contract_deployments WHERE contract_id = $1`,
        [contractId],
      );

      if (parseInt(otherDeploymentsResult.rows[0].count) === 0) {
        await client.query(`DELETE FROM contracts WHERE id = $1`, [contractId]);
        stats.contractsDeleted++;
      }
    }
    console.log(`✓ Deleted ${stats.contractsDeleted} contract(s)`);

    // 12. Delete orphaned code entries
    const codeHashesToCheck = new Set<Buffer>();

    // Add code hashes from compiled_contracts
    for (const codeHashes of compilationCodeHashes.values()) {
      if (codeHashes.creation) codeHashesToCheck.add(codeHashes.creation);
      if (codeHashes.runtime) codeHashesToCheck.add(codeHashes.runtime);
    }

    // Add code hashes from contracts
    for (const codeHashes of contractCodeHashes.values()) {
      if (codeHashes.creation) codeHashesToCheck.add(codeHashes.creation);
      if (codeHashes.runtime) codeHashesToCheck.add(codeHashes.runtime);
    }

    for (const codeHash of codeHashesToCheck) {
      await deleteCodeIfOrphaned(client, codeHash, stats);
    }
    console.log(`✓ Deleted ${stats.codeEntriesDeleted} code entrie(s) (not referenced elsewhere)`);

    await client.query("COMMIT");
    console.log("\n✅ Transaction committed successfully\n");

    return stats;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("\n❌ Transaction rolled back due to error\n");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error(
      "Usage: npx tsx scripts/delete-sourcify-match.ts <chain_id> <contract_address>",
    );
    console.error(
      "Example: npx tsx scripts/delete-sourcify-match.ts 1 0x1234567890123456789012345678901234567890",
    );
    process.exit(1);
  }

  const chainId = parseInt(args[0]);
  const address = args[1];

  if (isNaN(chainId)) {
    console.error("Error: chain_id must be a number");
    process.exit(1);
  }

  if (!/^(0x)?[0-9a-fA-F]{40}$/.test(address)) {
    console.error(
      "Error: contract_address must be a valid Ethereum address (40 hex characters)",
    );
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Sourcify Match Deletion Script");
  console.log("═══════════════════════════════════════════════════════");

  try {
    const stats = await deleteVerifiedContracts(chainId, address);

    console.log("═══════════════════════════════════════════════════════");
    console.log("  Deletion Summary");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`Verified Contracts Found:           ${stats.verifiedContractsFound}`);
    console.log(`Sourcify Matches Deleted:           ${stats.sourcifyMatchesDeleted}`);
    console.log(`Verified Contracts Deleted:         ${stats.verifiedContractsDeleted}`);
    console.log(`Verification Jobs Deleted:          ${stats.verificationJobsDeleted}`);
    console.log(`Contract Deployments Deleted:       ${stats.contractDeploymentsDeleted}`);
    console.log(`Compiled Contracts Deleted:         ${stats.compiledContractsDeleted}`);
    console.log(`Contracts Deleted:                  ${stats.contractsDeleted}`);
    console.log(`Compiled Contracts Sources Deleted: ${stats.compiledContractsSourcesDeleted}`);
    console.log(`Sources Deleted:                    ${stats.sourcesDeleted}`);
    console.log(`Compiled Contracts Sigs Deleted:    ${stats.compiledContractsSignaturesDeleted}`);
    console.log(`Signatures Deleted:                 ${stats.signaturesDeleted}`);
    console.log(`Code Entries Deleted:               ${stats.codeEntriesDeleted}`);
    console.log("═══════════════════════════════════════════════════════\n");
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
