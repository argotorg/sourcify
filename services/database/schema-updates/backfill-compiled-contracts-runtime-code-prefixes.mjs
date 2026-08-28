/**
 * Backfills compiled_contracts_runtime_code_prefixes from existing
 * compiled_contracts rows.
 *
 * Required after applying the migration that adds the prefix side table
 * (20260803100000_add_compiled_contracts_runtime_code_prefixes.sql): the
 * insert trigger only covers compilations created after the migration, so
 * existing rows are filled out-of-band by this script. Until it has finished,
 * similarity search simply sees fewer candidates.
 *
 * Skipped rows (consistent with the trigger):
 *   - runtime code is NULL (the designated "no code" row)
 *   - runtime code shorter than 75 bytes
 *
 * The script is idempotent and resumable: inserts use ON CONFLICT DO NOTHING
 * and the table is walked in primary-key order with a keyset cursor
 * (compiled_contracts.id is a uuid, so ranges are cursor-based rather than
 * numeric). Safe to Ctrl+C and re-run.
 *
 * See: https://github.com/argotorg/sourcify/issues/2891
 *
 * Environment Variables Required:
 *   - POSTGRES_HOST
 *   - POSTGRES_PORT
 *   - POSTGRES_DB
 *   - POSTGRES_USER
 *   - POSTGRES_PASSWORD
 *
 * Example:
 *   node backfill-compiled-contracts-runtime-code-prefixes.mjs --batch-size=10000 --sleep-ms=50
 */

import { program } from "commander";
import dotenv from "dotenv";
import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;
dotenv.config({ path: "../.env" });

const schema = process.env.POSTGRES_SCHEMA || "public";

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

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
    "Backfill compiled_contracts_runtime_code_prefixes from compiled_contracts.\n" +
      "Idempotent and resumable. Run after applying the prefix table migration.\n\n" +
      "Logging level can be configured via NODE_LOG_LEVEL (default: 'info').",
  )
  .option(
    "-b, --batch-size <number>",
    "Number of compilations to process per batch",
    (v) => parsePositiveInt(v, 10000),
    10000,
  )
  .option(
    // Throttle: without a pause the backfill is one continuous full-speed
    // workload competing with live traffic for I/O and WAL bandwidth and
    // building replication lag. The gaps let other work catch up, at the cost
    // of a few seconds of total runtime. Set to 0 in an idle window, raise it
    // if the database is under pressure while the script runs.
    "-s, --sleep-ms <number>",
    "Milliseconds to sleep between batches",
    (v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : 50;
    },
    50,
  )
  .option(
    "--start-id <uuid>",
    "Resume from this compiled_contracts.id (exclusive). Defaults to the zero uuid.",
    UUID_ZERO,
  )
  .option(
    "--dry-run",
    "Report what would be inserted without writing anything.",
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

    logger.info(
      "Starting backfill of compiled_contracts_runtime_code_prefixes",
      {
        batchSize: options.batchSize,
        sleepMs: options.sleepMs,
        startId: options.startId,
        dryRun: options.dryRun,
      },
    );

    const estimate = await activePool.query(
      `SELECT GREATEST(reltuples, 0)::bigint AS estimated_rows
       FROM pg_class
       WHERE oid = '${schema}.compiled_contracts'::regclass`,
    );
    const estimatedRows = parseInt(estimate.rows[0].estimated_rows, 10);
    logger.info("Estimated compiled_contracts rows", { estimatedRows });

    let cursor = options.startId;
    let totalProcessed = 0;
    let totalInserted = 0;
    const startTime = Date.now();

    for (;;) {
      const batchStart = Date.now();
      let batchRows;
      let insertedRows;
      let lastId;

      if (options.dryRun) {
        const result = await activePool.query(
          `WITH batch AS (
             SELECT cc.id
             FROM ${schema}.compiled_contracts cc
             JOIN ${schema}.code c ON c.code_hash = cc.runtime_code_hash
             WHERE cc.id > $1::uuid
               AND c.code IS NOT NULL
               AND octet_length(c.code) >= 75
             ORDER BY cc.id
             LIMIT $2
           )
           SELECT (SELECT count(*) FROM batch) AS batch_rows,
                  (SELECT id FROM batch ORDER BY id DESC LIMIT 1) AS last_id`,
          [cursor, options.batchSize],
        );
        batchRows = parseInt(result.rows[0].batch_rows, 10);
        insertedRows = 0;
        lastId = result.rows[0].last_id;
      } else {
        const result = await activePool.query(
          `WITH batch AS (
             SELECT cc.id, substring(c.code FROM 1 FOR 75) AS runtime_code_prefix
             FROM ${schema}.compiled_contracts cc
             JOIN ${schema}.code c ON c.code_hash = cc.runtime_code_hash
             WHERE cc.id > $1::uuid
               AND c.code IS NOT NULL
               AND octet_length(c.code) >= 75
             ORDER BY cc.id
             LIMIT $2
           ),
           inserted AS (
             INSERT INTO ${schema}.compiled_contracts_runtime_code_prefixes (compilation_id, runtime_code_prefix)
             SELECT id, runtime_code_prefix FROM batch
             ON CONFLICT (compilation_id) DO NOTHING
             RETURNING 1
           )
           SELECT (SELECT count(*) FROM batch) AS batch_rows,
                  (SELECT count(*) FROM inserted) AS inserted_rows,
                  (SELECT id FROM batch ORDER BY id DESC LIMIT 1) AS last_id`,
          [cursor, options.batchSize],
        );
        batchRows = parseInt(result.rows[0].batch_rows, 10);
        insertedRows = parseInt(result.rows[0].inserted_rows, 10);
        lastId = result.rows[0].last_id;
      }

      if (batchRows === 0) {
        break;
      }

      cursor = lastId;
      totalProcessed += batchRows;
      totalInserted += insertedRows;

      const elapsedSec = (Date.now() - startTime) / 1000;
      const rowsPerSec = elapsedSec > 0 ? totalProcessed / elapsedSec : 0;
      const remaining = Math.max(0, estimatedRows - totalProcessed);
      const etaSec = rowsPerSec > 0 ? remaining / rowsPerSec : 0;

      logger.info(options.dryRun ? "[dry-run] batch" : "Batch complete", {
        lastId,
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

    if (!options.dryRun) {
      const counts = await activePool.query(
        `SELECT count(*) AS prefix_rows
         FROM ${schema}.compiled_contracts_runtime_code_prefixes`,
      );
      logger.info("Prefix table row count", {
        prefixRows: counts.rows[0].prefix_rows,
      });

      // A freshly filled table has no statistics; without them the planner
      // falls back to default estimates for the new index.
      try {
        await activePool.query(
          `ANALYZE ${schema}.compiled_contracts_runtime_code_prefixes`,
        );
        logger.info("ANALYZE completed on compiled_contracts_runtime_code_prefixes");
      } catch (err) {
        logger.warn(
          "ANALYZE failed (needs table owner); run it manually before enabling the new query",
          { error: err.message },
        );
      }
    }

    await closePool();
  });

program.parse();
