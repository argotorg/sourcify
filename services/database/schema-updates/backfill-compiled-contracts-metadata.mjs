/**
 * Backfills compiled_contracts_metadata from sourcify_matches.metadata.
 *
 * Required after applying the migration that adds the metadata side table
 * (20260826100000_add_compiled_contracts_metadata.sql): the server only writes
 * metadata for compilations created after the migration, so compilations
 * verified before it are filled out-of-band by this script. Until it has
 * finished, reads keep using sourcify_matches.metadata, so nothing is missing
 * in the meantime.
 *
 * Two phases:
 *   1. Work list: one set-based pass picks each compilation's metadata donor,
 *      the earliest current match (lowest verified_contracts.id) -- the first
 *      submitter wins, consistent with how sources are deduplicated for a
 *      shared compilation. Compilations that already have a row are excluded,
 *      so re-runs only do the remaining work.
 *   2. Copy: the donors' metadata blobs are inserted in batches, walking
 *      sourcify_matches in id order for I/O locality, with a throttle sleep
 *      between batches. Inserts are ON CONFLICT DO NOTHING, so rows written
 *      concurrently by the live server are left untouched.
 *
 * Idempotent and resumable: safe to Ctrl+C and re-run at any point.
 *
 * See: https://github.com/argotorg/sourcify/issues/2924
 *
 * Environment Variables Required:
 *   - POSTGRES_HOST
 *   - POSTGRES_PORT
 *   - POSTGRES_DB
 *   - POSTGRES_USER
 *   - POSTGRES_PASSWORD
 *
 * Example:
 *   node backfill-compiled-contracts-metadata.mjs --batch-size=5000 --sleep-ms=50
 */

import { program } from "commander";
import dotenv from "dotenv";
import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;
dotenv.config({ path: "../.env" });

const schema = process.env.POSTGRES_SCHEMA || "public";

let activePool = null;
// The work list is a TEMP table, so every query must run on this one session
let activeClient = null;

const closePool = async () => {
  if (activeClient) {
    try {
      activeClient.release();
    } catch {
      // already released
    }
    activeClient = null;
  }
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
    "Backfill compiled_contracts_metadata from sourcify_matches.metadata.\n" +
      "Idempotent and resumable. Run after applying the metadata side table migration\n" +
      "on a server version that already dual-writes to compiled_contracts_metadata.\n\n" +
      "Logging level can be configured via NODE_LOG_LEVEL (default: 'info').",
  )
  .option(
    "-b, --batch-size <number>",
    "Number of metadata rows to copy per batch",
    (v) => parsePositiveInt(v, 5000),
    5000,
  )
  .option(
    // Throttle: without a pause the backfill is one continuous full-speed
    // workload competing with live traffic for I/O and WAL bandwidth and
    // building replication lag. The gaps let other work catch up, at the cost
    // of some total runtime. Set to 0 in an idle window, raise it if the
    // database is under pressure while the script runs.
    "-s, --sleep-ms <number>",
    "Milliseconds to sleep between batches",
    (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : 50;
    },
    50,
  )
  .option(
    "--dry-run",
    "Only build the work list and report how many rows would be inserted, then exit.",
    false,
  )
  .option(
    // The completeness check joins all sourcify_matches once (index-driven, no
    // metadata detoasting), so it is much heavier than the count reported at
    // the end of a normal run. Use it before switching reads over to the side
    // table.
    "--verify",
    "Only count compilations still missing their side table row, then exit.",
    false,
  )
  .action(async (options) => {
    activePool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT,
      database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      keepAlive: true,
    });

    if (options.verify) {
      logger.info("Verifying compiled_contracts_metadata completeness");
      // Counts the gap directly: comparing totals instead could hide gaps,
      // because the side table also keeps rows for compilations that no
      // current match points to anymore.
      const result = await activePool.query(
        `SELECT count(DISTINCT vc.compilation_id) AS missing_rows
         FROM ${schema}.verified_contracts vc
         JOIN ${schema}.sourcify_matches sm ON sm.verified_contract_id = vc.id
         WHERE sm.metadata IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ${schema}.compiled_contracts_metadata ccm
                           WHERE ccm.compilation_id = vc.compilation_id)`,
      );
      logger.info("Verification finished", {
        missingRows: parseInt(result.rows[0].missing_rows, 10),
      });
      await closePool();
      return;
    }

    logger.info("Starting backfill of compiled_contracts_metadata", {
      batchSize: options.batchSize,
      sleepMs: options.sleepMs,
      dryRun: options.dryRun,
    });

    activeClient = await activePool.connect();

    // Phase 1: sequential scans and an ids-only sort; no metadata is read here
    const workListStart = Date.now();
    logger.info("Building work list (first current match per compilation)");
    await activeClient.query(
      `CREATE TEMP TABLE metadata_winners AS
       SELECT DISTINCT ON (vc.compilation_id) vc.compilation_id, sm.id AS match_id
       FROM ${schema}.verified_contracts vc
       JOIN ${schema}.sourcify_matches sm ON sm.verified_contract_id = vc.id
       WHERE sm.metadata IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ${schema}.compiled_contracts_metadata ccm
                         WHERE ccm.compilation_id = vc.compilation_id)
       ORDER BY vc.compilation_id, vc.id`,
    );
    await activeClient.query(`CREATE INDEX ON metadata_winners (match_id)`);
    const workList = await activeClient.query(
      `SELECT count(*) AS insertable FROM metadata_winners`,
    );
    const totalRows = parseInt(workList.rows[0].insertable, 10);
    logger.info("Work list ready", {
      insertableRows: totalRows,
      buildMs: Date.now() - workListStart,
    });

    if (options.dryRun) {
      logger.info("[dry-run] exiting without writing");
      await closePool();
      return;
    }

    // Phase 2: copy the blobs in match id order
    let cursor = "0";
    let totalProcessed = 0;
    let totalInserted = 0;
    const startTime = Date.now();

    for (;;) {
      const batchStart = Date.now();
      const result = await activeClient.query(
        `WITH batch AS (
           SELECT compilation_id, match_id
           FROM metadata_winners
           WHERE match_id > $1
           ORDER BY match_id
           LIMIT $2
         ),
         inserted AS (
           INSERT INTO ${schema}.compiled_contracts_metadata (compilation_id, metadata)
           SELECT batch.compilation_id, sm.metadata
           FROM batch
           JOIN ${schema}.sourcify_matches sm ON sm.id = batch.match_id
           ON CONFLICT ON CONSTRAINT compiled_contracts_metadata_pkey DO NOTHING
           RETURNING 1
         )
         SELECT (SELECT count(*) FROM batch) AS batch_rows,
                (SELECT count(*) FROM inserted) AS inserted_rows,
                (SELECT max(match_id) FROM batch) AS last_id`,
        [cursor, options.batchSize],
      );
      const batchRows = parseInt(result.rows[0].batch_rows, 10);
      const insertedRows = parseInt(result.rows[0].inserted_rows, 10);

      if (batchRows === 0) {
        break;
      }

      cursor = result.rows[0].last_id;
      totalProcessed += batchRows;
      totalInserted += insertedRows;

      const elapsedSec = (Date.now() - startTime) / 1000;
      const rowsPerSec = elapsedSec > 0 ? totalProcessed / elapsedSec : 0;
      const remaining = Math.max(0, totalRows - totalProcessed);
      const etaSec = rowsPerSec > 0 ? remaining / rowsPerSec : 0;

      logger.info("Batch complete", {
        lastMatchId: cursor,
        batchRows,
        insertedRows,
        totalProcessed,
        totalInserted,
        batchMs: Date.now() - batchStart,
        etaMinutes: Math.round(etaSec / 60),
      });

      if (options.sleepMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.sleepMs));
      }
    }

    logger.info("Backfill finished", {
      totalProcessed,
      totalInserted,
      elapsedMinutes: Math.round((Date.now() - startTime) / 60000),
    });

    const counts = await activeClient.query(
      `SELECT count(*) AS metadata_rows
       FROM ${schema}.compiled_contracts_metadata`,
    );
    logger.info("Metadata table row count", {
      metadataRows: counts.rows[0].metadata_rows,
    });

    // A freshly filled table has no statistics; without them the planner
    // falls back to default estimates for the primary key joins.
    try {
      await activeClient.query(`ANALYZE ${schema}.compiled_contracts_metadata`);
      logger.info("ANALYZE completed on compiled_contracts_metadata");
    } catch (err) {
      logger.warn(
        "ANALYZE failed (needs table owner); run it manually before switching reads to the new table",
        { error: err.message },
      );
    }

    await closePool();
  });

program.parseAsync().catch(async (err) => {
  logger.error("Fatal error", { error: err.message, stack: err.stack });
  await closePool();
  process.exit(1);
});
