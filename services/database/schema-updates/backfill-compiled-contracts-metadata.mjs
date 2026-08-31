/**
 * Backfills compiled_contracts_metadata from sourcify_matches.metadata.
 *
 * Required after applying the migration that adds the metadata side table
 * (20260826100000_add_compiled_contracts_metadata.sql): the server only writes
 * metadata for verifications stored after the migration, so compilations
 * verified before it are filled out-of-band by this script. Until it has
 * finished, reads keep using sourcify_matches.metadata, so nothing is missing
 * in the meantime.
 *
 * For each compilation the metadata of its earliest current sourcify_match
 * (lowest verified_contracts.id) is stored -- the first submitter wins,
 * consistent with how sources are deduplicated for a shared compilation.
 * Compilations without any match, or whose matches all have NULL metadata,
 * get no row.
 *
 * The script is idempotent and resumable: inserts use ON CONFLICT DO NOTHING
 * and the table is walked in primary-key order with a keyset cursor
 * (compiled_contracts.id is a uuid, so ranges are cursor-based rather than
 * numeric). Safe to Ctrl+C and re-run. Rows written concurrently by the live
 * server are left untouched.
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

// The LATERAL picks each compilation's first-submitted metadata; both hops
// (verified_contracts by compilation_id, sourcify_matches by
// verified_contract_id) are index-driven. Ordering by verified_contracts.id
// makes the picked variant deterministic across re-runs.
const firstMatchMetadataLateral = `
  CROSS JOIN LATERAL (
    SELECT sm.metadata
    FROM ${schema}.verified_contracts vc
    JOIN ${schema}.sourcify_matches sm ON sm.verified_contract_id = vc.id
    WHERE vc.compilation_id = batch.id
      AND sm.metadata IS NOT NULL
    ORDER BY vc.id
    LIMIT 1
  ) first_match`;

// Makes re-runs skip already-filled compilations. Filters batch_metadata, not
// batch, so the cursor still advances through completed ranges.
const skipExistingRows = `
  WHERE NOT EXISTS (
    SELECT 1 FROM ${schema}.compiled_contracts_metadata ccm
    WHERE ccm.compilation_id = batch.id
  )`;

program
  .description(
    "Backfill compiled_contracts_metadata from sourcify_matches.metadata.\n" +
      "Idempotent and resumable. Run after applying the metadata side table migration\n" +
      "on a server version that already dual-writes to compiled_contracts_metadata.\n\n" +
      "Logging level can be configured via NODE_LOG_LEVEL (default: 'info').",
  )
  .option(
    "-b, --batch-size <number>",
    "Number of compilations to process per batch",
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
    "--start-id <uuid>",
    "Resume from this compiled_contracts.id (exclusive). Defaults to the zero uuid.",
    UUID_ZERO,
  )
  .option(
    "--dry-run",
    "Report what would be inserted without writing anything.",
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
      startId: options.startId,
      dryRun: options.dryRun,
    });

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
             SELECT compiled_contracts.id
             FROM ${schema}.compiled_contracts
             WHERE compiled_contracts.id > $1::uuid
             ORDER BY compiled_contracts.id
             LIMIT $2
           ),
           batch_metadata AS (
             SELECT batch.id AS compilation_id
             FROM batch
             ${firstMatchMetadataLateral}
             ${skipExistingRows}
           )
           SELECT (SELECT count(*) FROM batch) AS batch_rows,
                  (SELECT count(*) FROM batch_metadata) AS insertable_rows,
                  (SELECT id FROM batch ORDER BY id DESC LIMIT 1) AS last_id`,
          [cursor, options.batchSize],
        );
        batchRows = parseInt(result.rows[0].batch_rows, 10);
        insertedRows = 0;
        lastId = result.rows[0].last_id;
        logger.debug("[dry-run] insertable rows in batch", {
          insertableRows: parseInt(result.rows[0].insertable_rows, 10),
        });
      } else {
        const result = await activePool.query(
          `WITH batch AS (
             SELECT compiled_contracts.id
             FROM ${schema}.compiled_contracts
             WHERE compiled_contracts.id > $1::uuid
             ORDER BY compiled_contracts.id
             LIMIT $2
           ),
           batch_metadata AS (
             SELECT batch.id AS compilation_id, first_match.metadata
             FROM batch
             ${firstMatchMetadataLateral}
             ${skipExistingRows}
           ),
           inserted AS (
             INSERT INTO ${schema}.compiled_contracts_metadata (compilation_id, metadata)
             SELECT compilation_id, metadata FROM batch_metadata
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
        `SELECT count(*) AS metadata_rows
         FROM ${schema}.compiled_contracts_metadata`,
      );
      logger.info("Metadata table row count", {
        metadataRows: counts.rows[0].metadata_rows,
      });

      // A freshly filled table has no statistics; without them the planner
      // falls back to default estimates for the primary key joins.
      try {
        await activePool.query(`ANALYZE ${schema}.compiled_contracts_metadata`);
        logger.info("ANALYZE completed on compiled_contracts_metadata");
      } catch (err) {
        logger.warn(
          "ANALYZE failed (needs table owner); run it manually before switching reads to the new table",
          { error: err.message },
        );
      }
    }

    await closePool();
  });

program.parseAsync().catch(async (err) => {
  logger.error("Fatal error", { error: err.message, stack: err.stack });
  await closePool();
  process.exit(1);
});
