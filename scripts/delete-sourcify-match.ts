#!/usr/bin/env tsx
/**
 * Script to delete all verified_contracts and their related data for a given chain_id and address.
 * Supports both PostgreSQL and BigQuery databases.
 *
 * Usage:
 *   npx tsx scripts/delete-sourcify-match.ts <chain_id> <contract_address>
 *
 * Example:
 *   npx tsx scripts/delete-sourcify-match.ts 1 0x1234567890123456789012345678901234567890
 *
 * Configuration (in scripts/.env):
 *   DATABASE_TYPE=postgres or bigquery
 *   DRY_RUN=true (to preview changes without committing) or false (to commit changes)
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
import { BigQuery } from "@google-cloud/bigquery";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from scripts/.env
dotenv.config({ path: path.join(__dirname, ".env") });

type DatabaseType = "postgres" | "bigquery";

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

// Database abstraction interface
interface DatabaseClient {
  query(sql: string, params?: any[]): Promise<any>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  close(): Promise<void>;
}

// PostgreSQL client wrapper
class PostgresClient implements DatabaseClient {
  private client: PoolClient;
  private pool: Pool;

  constructor(pool: Pool, client: PoolClient) {
    this.pool = pool;
    this.client = client;
  }

  async query(sql: string, params?: any[]): Promise<any> {
    // Convert parameter placeholders for postgres ($1, $2, etc.)
    const result = await this.client.query(sql, params);
    return result.rows;
  }

  async beginTransaction(): Promise<void> {
    await this.client.query("BEGIN");
  }

  async commitTransaction(): Promise<void> {
    await this.client.query("COMMIT");
  }

  async rollbackTransaction(): Promise<void> {
    await this.client.query("ROLLBACK");
  }

  async close(): Promise<void> {
    this.client.release();
    await this.pool.end();
  }
}

// BigQuery client wrapper
class BigQueryClient implements DatabaseClient {
  private bigquery: any;
  private session: any;
  private dataset: string;

  constructor(bigquery: any, dataset: string) {
    this.bigquery = bigquery;
    this.dataset = dataset;
  }

  async init(): Promise<void> {
    const [session] = await this.bigquery.createSession();
    this.session = session;
  }

  async query(sql: string, params?: any[]): Promise<any> {
    // Convert PostgreSQL $1, $2 to BigQuery @param0, @param1
    let convertedSql = sql;
    const namedParams: Record<string, any> = {};

    if (params && params.length > 0) {
      params.forEach((param, index) => {
        const paramName = `param${index}`;
        convertedSql = convertedSql.replace(`$${index + 1}`, `@${paramName}`);
        namedParams[paramName] = param;
      });
    }

    // Add dataset prefix to table names (basic implementation)
    convertedSql = this.addDatasetPrefix(convertedSql);

    const [rows] = await this.session.query({
      query: convertedSql,
      params: namedParams,
      useLegacySql: false,
    });

    return rows || [];
  }

  private addDatasetPrefix(sql: string): string {
    // Add dataset prefix to table names
    // This is a simple implementation - matches table names after FROM, JOIN, UPDATE, DELETE FROM, INSERT INTO
    const tables = [
      "sourcify_matches",
      "verified_contracts",
      "contract_deployments",
      "compiled_contracts",
      "compiled_contracts_sources",
      "compiled_contracts_signatures",
      "sources",
      "signatures",
      "code",
      "contracts",
      "verification_jobs",
      "verification_jobs_ephemeral",
      "INFORMATION_SCHEMA.TABLES",
    ];

    let result = sql;
    for (const table of tables) {
      if (table === "INFORMATION_SCHEMA.TABLES") {
        // Don't prefix INFORMATION_SCHEMA
        continue;
      }
      // Match table names with word boundaries
      const regex = new RegExp(`\\b${table}\\b`, "g");
      result = result.replace(regex, `\`${this.dataset}.${table}\``);
    }

    return result;
  }

  async beginTransaction(): Promise<void> {
    await this.session.query("BEGIN TRANSACTION");
  }

  async commitTransaction(): Promise<void> {
    await this.session.query("COMMIT TRANSACTION");
  }

  async rollbackTransaction(): Promise<void> {
    await this.session.query("ROLLBACK TRANSACTION");
  }

  async close(): Promise<void> {
    if (this.session) {
      await this.session.close();
    }
  }
}

async function createDatabaseClient(
  dbType: DatabaseType,
): Promise<DatabaseClient> {
  if (dbType === "postgres") {
    const pool = new Pool({
      host: process.env.SOURCIFY_POSTGRES_HOST || "localhost",
      port: parseInt(process.env.SOURCIFY_POSTGRES_PORT || "5432"),
      database: process.env.SOURCIFY_POSTGRES_DB || "sourcify",
      user: process.env.SOURCIFY_POSTGRES_USER || "sourcify",
      password: process.env.SOURCIFY_POSTGRES_PASSWORD,
    });
    const client = await pool.connect();
    return new PostgresClient(pool, client);
  } else {
    // BigQuery mode
    const bigquery = new BigQuery({
      projectId: process.env.BIGQUERY_PROJECT_ID,
    });
    const dataset = process.env.BIGQUERY_DATASET || "sourcify";
    const client = new BigQueryClient(bigquery, dataset);
    await client.init();
    return client;
  }
}

async function deleteCompiledContractSources(
  client: DatabaseClient,
  compilationId: string,
  stats: DeleteStats,
): Promise<void> {
  // Get all source_hashes for this compilation
  const sourcesResult = await client.query(
    `SELECT source_hash FROM compiled_contracts_sources WHERE compilation_id = $1`,
    [compilationId],
  );

  for (const row of sourcesResult) {
    const sourceHash = row.source_hash;

    // Check if this source is referenced by other compiled_contracts_sources
    const otherSourceRefsResult = await client.query(
      `SELECT COUNT(*) as count FROM compiled_contracts_sources WHERE source_hash = $1 AND compilation_id != $2`,
      [sourceHash, compilationId],
    );

    const canDeleteSource = parseInt(otherSourceRefsResult[0].count) === 0;

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
  client: DatabaseClient,
  compilationId: string,
  stats: DeleteStats,
): Promise<void> {
  // Get all signature_hash_32 for this compilation
  const signaturesResult = await client.query(
    `SELECT signature_hash_32 FROM compiled_contracts_signatures WHERE compilation_id = $1`,
    [compilationId],
  );

  console.log(
    `⏱️  Processing ${signaturesResult.length} signatures for compilation ${compilationId}. For many signatures this may take 10-20 minutes...`,
  );

  for (const row of signaturesResult) {
    const signatureHash = row.signature_hash_32;

    // Check if this signature is referenced by other compiled_contracts_signatures
    const otherSigRefsResult = await client.query(
      `SELECT COUNT(*) as count FROM compiled_contracts_signatures WHERE signature_hash_32 = $1 AND compilation_id != $2`,
      [signatureHash, compilationId],
    );

    const canDeleteSignature = parseInt(otherSigRefsResult[0].count) === 0;

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
  client: DatabaseClient,
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
    parseInt(otherCompiledContractsResult[0].count) === 0 &&
    parseInt(otherContractsResult[0].count) === 0;

  if (canDeleteCode) {
    await client.query(`DELETE FROM code WHERE code_hash = $1`, [codeHash]);
    stats.codeEntriesDeleted++;
  }
}

async function tableExists(
  client: DatabaseClient,
  tableName: string,
  dbType: DatabaseType,
): Promise<boolean> {
  if (dbType === "postgres") {
    const result = await client.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = $1
      )`,
      [tableName],
    );
    return result[0].exists;
  } else {
    // BigQuery
    const dataset = process.env.BIGQUERY_DATASET || "sourcify";
    const projectId = process.env.BIGQUERY_PROJECT_ID;
    try {
      const result = await client.query(
        `SELECT COUNT(*) > 0 as table_exists
         FROM \`${projectId}.${dataset}.INFORMATION_SCHEMA.TABLES\`
         WHERE table_name = $1`,
        [tableName],
      );
      return result[0]?.table_exists === true;
    } catch (error) {
      // If INFORMATION_SCHEMA query fails, assume table doesn't exist
      return false;
    }
  }
}

async function deleteVerifiedContracts(
  chainId: number,
  address: string,
  dbType: DatabaseType,
): Promise<DeleteStats> {
  const client = await createDatabaseClient(dbType);

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

  try {
    await client.beginTransaction();

    // Normalize address to bytea/BYTES format (remove 0x prefix if present)
    const normalizedAddress = address.toLowerCase().startsWith("0x")
      ? address.substring(2)
      : address;
    const addressBytes = Buffer.from(normalizedAddress, "hex");

    console.log(
      `\n🔍 Looking for verified_contracts with chain_id=${chainId} and address=0x${normalizedAddress}...\n`,
    );

    // 1. Find ALL verified_contracts for this chain_id and address
    const verifiedContractsResult: VerifiedContractInfo[] = await client.query(
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

    if (verifiedContractsResult.length === 0) {
      throw new Error(
        `No verified_contracts found for chain_id=${chainId} and address=0x${normalizedAddress}`,
      );
    }

    stats.verifiedContractsFound = verifiedContractsResult.length;
    console.log(
      `✓ Found ${stats.verifiedContractsFound} verified_contract(s)\n`,
    );

    // Track unique IDs to avoid redundant deletions and checks
    const verifiedContractIds = new Set<string>();
    const compilationIds = new Set<string>();
    const deploymentIds = new Set<string>();
    const contractIds = new Set<string>();

    // Display all verified_contracts found
    verifiedContractsResult.forEach((vc: any, index: number) => {
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
    const verificationJobsTableExists = await tableExists(
      client,
      "verification_jobs",
      dbType,
    );

    if (verificationJobsTableExists) {
      for (const verifiedContractId of verifiedContractIds) {
        // Get all verification_jobs ids for this verified_contract
        const jobsResult = await client.query(
          `SELECT id FROM verification_jobs WHERE verified_contract_id = $1`,
          [verifiedContractId],
        );

        // Delete from verification_jobs_ephemeral first (foreign key constraint)
        for (const job of jobsResult) {
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
        // For BigQuery, rowCount might not be available, so we use the jobs length
        stats.verificationJobsDeleted += jobsResult.length;
      }
      console.log(
        `✓ Deleted ${stats.verificationJobsDeleted} verification_job(s) and ephemeral data`,
      );
    } else {
      console.log(`⊘ Skipped verification_jobs (table does not exist)`);
    }

    // 3. Delete sourcify_matches for all verified_contracts (if table exists)
    const sourcifyMatchesTableExists = await tableExists(
      client,
      "sourcify_matches",
      dbType,
    );

    if (sourcifyMatchesTableExists) {
      // Query sourcify_match_ids for each verified_contract
      for (const verifiedContractId of verifiedContractIds) {
        const sourcifyMatchResult = await client.query(
          `SELECT id FROM sourcify_matches WHERE verified_contract_id = $1`,
          [verifiedContractId],
        );

        if (sourcifyMatchResult.length > 0) {
          for (const match of sourcifyMatchResult) {
            await client.query(`DELETE FROM sourcify_matches WHERE id = $1`, [
              match.id,
            ]);
            stats.sourcifyMatchesDeleted++;
          }
        }
      }
      console.log(
        `✓ Deleted ${stats.sourcifyMatchesDeleted} sourcify_match(es)`,
      );
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
    console.log(
      `✓ Deleted ${stats.verifiedContractsDeleted} verified_contract(s)`,
    );

    // 5. Get code hashes from compiled_contracts before deleting
    const compilationCodeHashes = new Map<
      string,
      { creation: Buffer | null; runtime: Buffer }
    >();
    for (const compilationId of compilationIds) {
      const codeHashResult = await client.query(
        `SELECT creation_code_hash, runtime_code_hash FROM compiled_contracts WHERE id = $1`,
        [compilationId],
      );
      if (codeHashResult.length > 0) {
        compilationCodeHashes.set(compilationId, {
          creation: codeHashResult[0].creation_code_hash,
          runtime: codeHashResult[0].runtime_code_hash,
        });
      } else {
        console.error(
          `⚠️  Warning: compiled_contract with id ${compilationId} not found`,
        );
      }
    }

    // 6. Delete compiled_contracts_sources and orphaned sources
    for (const compilationId of compilationIds) {
      // Check if this compilation is referenced by other verified_contracts
      const otherVerifiedContractsResult = await client.query(
        `SELECT COUNT(*) as count FROM verified_contracts WHERE compilation_id = $1`,
        [compilationId],
      );

      if (parseInt(otherVerifiedContractsResult[0].count) === 0) {
        await deleteCompiledContractSources(client, compilationId, stats);
      }
    }
    console.log(
      `✓ Deleted ${stats.compiledContractsSourcesDeleted} compiled_contracts_sources`,
    );
    console.log(
      `✓ Deleted ${stats.sourcesDeleted} source(s) (not referenced elsewhere)`,
    );

    // 7. Delete compiled_contracts_signatures and orphaned signatures (if tables exist)
    const compiledContractsSignaturesTableExists = await tableExists(
      client,
      "compiled_contracts_signatures",
      dbType,
    );
    const signaturesTableExists = await tableExists(
      client,
      "signatures",
      dbType,
    );

    if (compiledContractsSignaturesTableExists && signaturesTableExists) {
      for (const compilationId of compilationIds) {
        // Check if this compilation is referenced by other verified_contracts
        const otherVerifiedContractsResult = await client.query(
          `SELECT COUNT(*) as count FROM verified_contracts WHERE compilation_id = $1`,
          [compilationId],
        );

        if (parseInt(otherVerifiedContractsResult[0].count) === 0) {
          await deleteCompiledContractSignatures(client, compilationId, stats);
        }
      }
      console.log(
        `✓ Deleted ${stats.compiledContractsSignaturesDeleted} compiled_contracts_signatures`,
      );
      console.log(
        `✓ Deleted ${stats.signaturesDeleted} signature(s) (not referenced elsewhere)`,
      );
    } else {
      console.log(
        `⊘ Skipped compiled_contracts_signatures and signatures (table(s) do not exist)`,
      );
    }

    // 8. Delete compiled_contracts if not referenced by other verified_contracts
    for (const compilationId of compilationIds) {
      const otherVerifiedContractsResult = await client.query(
        `SELECT COUNT(*) as count FROM verified_contracts WHERE compilation_id = $1`,
        [compilationId],
      );

      if (parseInt(otherVerifiedContractsResult[0].count) === 0) {
        await client.query(`DELETE FROM compiled_contracts WHERE id = $1`, [
          compilationId,
        ]);
        stats.compiledContractsDeleted++;
      }
    }
    console.log(
      `✓ Deleted ${stats.compiledContractsDeleted} compiled_contract(s)`,
    );

    // 9. Get code hashes from contracts before potentially deleting
    const contractCodeHashes = new Map<
      string,
      { creation: Buffer | null; runtime: Buffer }
    >();
    for (const contractId of contractIds) {
      const contractCodeHashResult = await client.query(
        `SELECT creation_code_hash, runtime_code_hash FROM contracts WHERE id = $1`,
        [contractId],
      );
      if (contractCodeHashResult.length > 0) {
        contractCodeHashes.set(contractId, {
          creation: contractCodeHashResult[0].creation_code_hash,
          runtime: contractCodeHashResult[0].runtime_code_hash,
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

      if (parseInt(otherVerifiedContractsResult[0].count) === 0) {
        await client.query(`DELETE FROM contract_deployments WHERE id = $1`, [
          deploymentId,
        ]);
        stats.contractDeploymentsDeleted++;
      }
    }
    console.log(
      `✓ Deleted ${stats.contractDeploymentsDeleted} contract_deployment(s)`,
    );

    // 11. Delete contracts if not referenced by other contract_deployments
    for (const contractId of contractIds) {
      const otherDeploymentsResult = await client.query(
        `SELECT COUNT(*) as count FROM contract_deployments WHERE contract_id = $1`,
        [contractId],
      );

      if (parseInt(otherDeploymentsResult[0].count) === 0) {
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
    console.log(
      `✓ Deleted ${stats.codeEntriesDeleted} code entrie(s) (not referenced elsewhere)`,
    );

    // Check if this is a dry run
    const isDryRun = process.env.DRY_RUN === "true";

    if (isDryRun) {
      await client.rollbackTransaction();
      console.log(
        "\n🔄 DRY RUN MODE: Transaction rolled back (no changes committed)\n",
      );
      console.log("💡 Set DRY_RUN=false in .env to commit changes\n");
    } else {
      await client.commitTransaction();
      console.log("\n✅ Transaction committed successfully\n");
    }

    return stats;
  } catch (error) {
    await client.rollbackTransaction();
    console.error("\n❌ Transaction rolled back due to error\n");
    throw error;
  } finally {
    await client.close();
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

  const dbType = (process.env.DATABASE_TYPE || "postgres") as DatabaseType;

  if (dbType !== "postgres" && dbType !== "bigquery") {
    console.error(
      "Error: DATABASE_TYPE must be either 'postgres' or 'bigquery'",
    );
    process.exit(1);
  }

  const isDryRun = process.env.DRY_RUN === "true";

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Sourcify Match Deletion Script");
  console.log(`  Database: ${dbType.toUpperCase()}`);
  console.log(
    `  Mode: ${isDryRun ? "DRY RUN (no changes will be committed)" : "LIVE (changes will be committed)"}`,
  );
  console.log("═══════════════════════════════════════════════════════");

  try {
    const stats = await deleteVerifiedContracts(chainId, address, dbType);

    console.log("═══════════════════════════════════════════════════════");
    console.log("  Deletion Summary");
    console.log("═══════════════════════════════════════════════════════");
    console.log(
      `Verified Contracts Found:           ${stats.verifiedContractsFound}`,
    );
    console.log(
      `Sourcify Matches Deleted:           ${stats.sourcifyMatchesDeleted}`,
    );
    console.log(
      `Verified Contracts Deleted:         ${stats.verifiedContractsDeleted}`,
    );
    console.log(
      `Verification Jobs Deleted:          ${stats.verificationJobsDeleted}`,
    );
    console.log(
      `Contract Deployments Deleted:       ${stats.contractDeploymentsDeleted}`,
    );
    console.log(
      `Compiled Contracts Deleted:         ${stats.compiledContractsDeleted}`,
    );
    console.log(
      `Contracts Deleted:                  ${stats.contractsDeleted}`,
    );
    console.log(
      `Compiled Contracts Sources Deleted: ${stats.compiledContractsSourcesDeleted}`,
    );
    console.log(`Sources Deleted:                    ${stats.sourcesDeleted}`);
    console.log(
      `Compiled Contracts Sigs Deleted:    ${stats.compiledContractsSignaturesDeleted}`,
    );
    console.log(
      `Signatures Deleted:                 ${stats.signaturesDeleted}`,
    );
    console.log(
      `Code Entries Deleted:               ${stats.codeEntriesDeleted}`,
    );
    console.log("═══════════════════════════════════════════════════════\n");
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
