/**
 * Backfills sourcify_matches.chain_id from contract_deployments.chain_id.
 *
 * Required after upgrading to sourcify-database@2.13.x, which adds the new
 * chain_id column to sourcify_matches but leaves it nullable so existing rows
 * can be filled out-of-band. Once this script has finished and no NULL rows
 * remain, the follow-up migration that promotes the column to NOT NULL is
 * safe to apply.
 *
 * The script is idempotent and resumable: it only touches rows where
 * chain_id IS NULL and walks the table in primary-key ranges, so each batch
 * runs in its own short transaction. Safe to Ctrl+C and re-run.
 *
 * See: https://github.com/argotorg/sourcify/issues/2111
 *
 * Environment Variables Required:
 *   - POSTGRES_HOST
 *   - POSTGRES_PORT
 *   - POSTGRES_DB
 *   - POSTGRES_USER
 *   - POSTGRES_PASSWORD
 *
 * Example:
 *   node post-v2.12-to-v2.13-upgrade.mjs --batch-size=50000 --sleep-ms=50
 */

import { program } from "commander";
import dotenv from "dotenv";
import pg from "pg";
import { logger } from "../scripts/logger.js";

const { Pool } = pg;
dotenv.config({ path: "../.env" });

const schema = process.env.POSTGRES_SCHEMA || "public";

let activePool = null;

const closePool = async () => {
  if (activePool) {
    try {
      await activePool.end();
      logger.info("Successfully closed database pool");
    } catch (err) {
      logger.error("Error closing pool", { error: err.message });
    }
    activePool = null;
  }
};

process.on("SIGINT", async () => {
  logger.info("Received SIGINT (Ctrl+C). Cleaning up...");
  await closePool();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM. Cleaning up...");
  await closePool();
  process.exit(0);
});

const parsePositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

program
  .description(
    "Backfill sourcify_matches.chain_id from contract_deployments.chain_id.\n" +
      "Idempotent and resumable. Run before applying the NOT NULL migration.\n\n" +
      "Logging level can be configured via NODE_LOG_LEVEL (default: 'info').",
  )
  .option(
    "-b, --batch-size <number>",
    "Number of primary-key ids to process per batch",
    (v) => parsePositiveInt(v, 50000),
    50000,
  )
  .option(
    "-s, --sleep-ms <number>",
    "Milliseconds to sleep between batches",
    (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : 50;
    },
    50,
  )
  .option(
    "--start-id <number>",
    "Resume from this sourcify_matches.id (inclusive). Defaults to MIN(id) of NULL rows.",
    (v) => parsePositiveInt(v, null),
  )
  .option(
    "--end-id <number>",
    "Stop before this sourcify_matches.id (exclusive). Defaults to MAX(id) of NULL rows + 1.",
    (v) => parsePositiveInt(v, null),
  )
  .option(
    "--dry-run",
    "Report what would be updated without writing anything.",
    false,
  )
  .action(async (options) => {
    activePool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT,
      database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    });

    logger.info("Starting backfill of sourcify_matches.chain_id", {
      batchSize: options.batchSize,
      sleepMs: options.sleepMs,
      dryRun: options.dryRun,
    });

    const bounds = await activePool.query(
      `SELECT MIN(id) AS min_id, MAX(id) AS max_id
       FROM ${schema}.sourcify_matches
       WHERE chain_id IS NULL`,
    );

    const minNullId = bounds.rows[0].min_id;
    const maxNullId = bounds.rows[0].max_id;

    if (minNullId === null) {
      logger.info(
        "No rows need backfill — sourcify_matches.chain_id is fully populated.",
      );
      await closePool();
      return;
    }

    logger.info("Found rows needing backfill", {
      minNullId: minNullId.toString(),
      maxNullId: maxNullId.toString(),
    });

    const startId =
      options.startId != null ? BigInt(options.startId) : BigInt(minNullId);
    const endId =
      options.endId != null ? BigInt(options.endId) : BigInt(maxNullId) + 1n;
    const batchSize = BigInt(options.batchSize);

    let totalUpdated = 0;
    let currentId = startId;
    const startTime = Date.now();

    while (currentId < endId) {
      const batchEnd =
        currentId + batchSize > endId ? endId : currentId + batchSize;

      const params = [currentId.toString(), batchEnd.toString()];

      if (options.dryRun) {
        const dryRunSql = `
          SELECT COUNT(*)::bigint AS to_update
          FROM ${schema}.sourcify_matches
          WHERE id >= $1::bigint AND id < $2::bigint AND chain_id IS NULL
        `;
        const result = await activePool.query(dryRunSql, params);
        const wouldUpdate = parseInt(result.rows[0].to_update, 10);
        totalUpdated += wouldUpdate;
        logger.info("[dry-run] batch", {
          startId: currentId.toString(),
          endId: batchEnd.toString(),
          wouldUpdate,
          totalWouldUpdate: totalUpdated,
        });
      } else {
        const updateSql = `
          UPDATE ${schema}.sourcify_matches sm
          SET chain_id = cd.chain_id
          FROM ${schema}.verified_contracts vc
          JOIN ${schema}.contract_deployments cd ON cd.id = vc.deployment_id
          WHERE vc.id = sm.verified_contract_id
            AND sm.id >= $1::bigint AND sm.id < $2::bigint
            AND sm.chain_id IS NULL
        `;

        const batchStart = Date.now();
        const result = await activePool.query(updateSql, params);
        const batchMs = Date.now() - batchStart;
        totalUpdated += result.rowCount;

        const elapsedSec = (Date.now() - startTime) / 1000;
        const rowsPerSec = elapsedSec > 0 ? totalUpdated / elapsedSec : 0;
        const remaining = endId - batchEnd;
        const etaSec =
          remaining > 0n && rowsPerSec > 0
            ? Number(remaining) / rowsPerSec
            : 0;

        logger.info("Batch complete", {
          startId: currentId.toString(),
          endId: batchEnd.toString(),
          updated: result.rowCount,
          totalUpdated,
          batchMs,
          rowsPerSec: Math.round(rowsPerSec),
          etaSec: Math.round(etaSec),
        });
      }

      currentId = batchEnd;

      if (options.sleepMs > 0 && currentId < endId) {
        await new Promise((resolve) => setTimeout(resolve, options.sleepMs));
      }
    }

    if (!options.dryRun) {
      const remaining = await activePool.query(
        `SELECT COUNT(*)::bigint AS null_count
         FROM ${schema}.sourcify_matches
         WHERE chain_id IS NULL`,
      );
      const nullCount = parseInt(remaining.rows[0].null_count, 10);

      if (nullCount === 0) {
        logger.info(
          "Backfill complete — 0 NULL rows remaining. Safe to apply the NOT NULL migration.",
        );
      } else {
        logger.warn(
          `Backfill finished but ${nullCount} NULL rows remain. Re-run the script or narrow the range with --start-id / --end-id to investigate.`,
        );
      }
    }

    logger.info("Summary", {
      totalUpdated,
      elapsedSec: Math.round((Date.now() - startTime) / 1000),
      dryRun: options.dryRun,
    });

    await closePool();
  });

program.parseAsync().catch(async (err) => {
  logger.error("Fatal error", { error: err.message, stack: err.stack });
  await closePool();
  process.exit(1);
});
