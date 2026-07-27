/**
 * Scripts to backfill the missing_transaction_hash table and verify contracts missing transaction hashes
 *
 * Environment Variables Required:
 *   - POSTGRES_HOST
 *   - POSTGRES_PORT
 *   - POSTGRES_DB
 *   - POSTGRES_USER
 *   - POSTGRES_PASSWORD
 *
 * @module BackfillCreation
 */

import { program } from "commander";
import dotenv from "dotenv";
import pg from "pg";
import { logger } from "./logger.js";
import { ContractVerifier } from "./ContractVerifier.mjs";

const { Pool } = pg;
dotenv.config({ path: "../.env" });

// The server no longer ships a bundled chains file; it fetches the same config
// from this URL at startup. Override with CHAINS_CONFIG_URL to match a
// self-hosted instance's sourcify-chains.json.
const CHAINS_CONFIG_URL =
  process.env.CHAINS_CONFIG_URL ||
  "https://storage.googleapis.com/sourcifyeth-chains/sourcify-chains-default.json";

logger.debug("Starting backfill-creation script", {
  moduleName: "BackfillCreation",
});

const fetchSupportedChainIds = async () => {
  const response = await fetch(CHAINS_CONFIG_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch chains config from ${CHAINS_CONFIG_URL}: HTTP ${response.status}`,
    );
  }
  const sourcifyChains = await response.json();

  return Object.entries(sourcifyChains)
    .filter(
      ([_, data]) =>
        data.supported === true &&
        data.fetchContractCreationTxUsing && // No point to verify contracts in chains we can't get the creation tx
        !data.fetchContractCreationTxUsing.blockscoutScrape, // Blockscout scraping almost always fails
      // TODO: We should implement the binary search for creation tx
    )
    .map(([chainId]) => chainId);
};

const createMissingTxTable = async (pool) => {
  const query = `
    CREATE TABLE IF NOT EXISTS missing_transaction_hash (
      id SERIAL PRIMARY KEY,
      chain_id numeric NOT NULL,
      address bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      reverified boolean DEFAULT false,
      CONSTRAINT missing_transaction_hash_unique UNIQUE (chain_id, address)
    );
  `;

  try {
    await pool.query(query);
    logger.info("Created missing_transaction_hash table if it didn't exist");
  } catch (err) {
    logger.error("Error creating table", { error: err });
    throw err;
  }
};

const findMissingTxHashes = async (pool, options, supportedChainIds) => {
  const query = `
    SELECT 
      cd.chain_id,
      cd.address,
      cd.transaction_hash
    FROM contract_deployments cd
    WHERE cd.transaction_hash = '\\x'
      OR cd.transaction_hash IS NULL
      AND cd.chain_id = ANY($1)
    ${options.limit ? "LIMIT $2" : ""}
  `;

  const params = [supportedChainIds];
  if (options.limit) {
    params.push(options.limit);
  }

  try {
    const result = await pool.query(query, params);
    logger.info(
      `Found ${result.rows.length} contracts missing transaction hashes`,
    );
    return result.rows;
  } catch (err) {
    logger.error("Error querying contracts", { error: err.message });
    throw err;
  }
};

const insertMissingTxHashes = async (pool, contracts) => {
  const query = `
    INSERT INTO missing_transaction_hash (chain_id, address)
    SELECT * FROM UNNEST($1::numeric[], $2::bytea[])
    ON CONFLICT (chain_id, address) DO NOTHING
  `;

  try {
    const chainIds = contracts.map((c) => c.chain_id);
    const addresses = contracts.map((c) => c.address);

    const result = await pool.query(query, [chainIds, addresses]);
    logger.info(`Successfully inserted ${result.rowCount} contracts`);
  } catch (err) {
    logger.error("Error batch inserting contracts", {
      error: err.message,
      contractCount: contracts.length,
    });
    throw err;
  }
};

// Add at the top of the file, after imports
let activePool = null;

// Add before program.parse
process.on("SIGINT", async () => {
  logger.info("Received SIGINT (Ctrl+C). Cleaning up...");
  if (activePool) {
    try {
      await activePool.end();
      logger.info("Successfully closed database pool");
    } catch (err) {
      logger.error("Error closing pool", { error: err.message });
    }
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM. Cleaning up...");
  if (activePool) {
    try {
      await activePool.end();
      logger.info("Successfully closed database pool");
    } catch (err) {
      logger.error("Error closing pool", { error: err.message });
    }
  }
  process.exit(0);
});

program
  .command("verify")
  .description(
    "Verify contracts missing transaction hashes. Requires the `missing_transaction_hash` table to be populated using the `find-missing-tx-hashes` command.\n" +
      "Logging level can be configured using NODE_LOG_LEVEL environment variable (default: 'info')\n\n" +
      "Example:\n" +
      "NODE_LOG_LEVEL=debug node backfill-creation.mjs verify \\\n" +
      "  --server=https://sourcify.dev/server/ \\\n" +
      "  --batch-size=400 \\\n" +
      "  --concurrent=200 \\\n" +
      "  --interval=100 \\\n" +
      "  --chains=10",
  )
  .requiredOption("-s, --server <url>", "Sourcify server URL")
  .option(
    "-b, --batch-size <number>",
    "Number of contracts to fetch at once",
    (value) => parseInt(value) || 100,
    100,
  )
  .option(
    "-c, --concurrent <number>",
    "Number of concurrent verifications",
    (value) => parseInt(value) || 5,
    5,
  )
  .option(
    "--cold-start-seconds <number>",
    "Number of seconds to ramp up concurrency to the given max value. Will use a logarithmic ramp up.",
    (value) => parseInt(value) || 300,
    300,
  )
  .option(
    "-i, --interval <number>",
    "Interval in milliseconds to wait between checking if a new contract can be verified concurrently",
    (value) => parseInt(value) || 100,
    100,
  )
  .option(
    "-l, --limit <number>",
    "Limit the number of contracts to verify",
    parseInt,
    Number.MAX_SAFE_INTEGER,
  )
  .option(
    "--chains <chains>",
    "Comma-separated list of chain IDs to verify. If not provided, all supported chains will be verified.",
    (value) => value.split(",").map(Number),
  )
  .action(async (options) => {
    activePool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT,
      database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    });

    try {
      const verifier = new ContractVerifier(activePool, options);
      await verifier.run();
      await activePool.end();
      activePool = null;
      process.exit(0);
    } catch (err) {
      logger.error("Script failed", { error: err.message });
      if (activePool) {
        await activePool.end();
        activePool = null;
      }
      process.exit(1);
    }
  });

program
  .command("find-missing-tx-hashes")
  .description(
    "Find contracts missing transaction hashes in the Sourcify DB, and insert them into the missing_transaction_hash table",
  )
  .option("-l, --limit <number>", "Limit the number of contracts to process")
  .option("-d, --dry-run", "Only show results without writing to database")
  .action(async (options) => {
    const pool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT,
      database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    });

    try {
      if (!options.dryRun) {
        await createMissingTxTable(pool);
      }

      const supportedChainIds = await fetchSupportedChainIds();
      logger.debug("Supported chains", {
        moduleName: "BackfillCreation",
        chainIds: supportedChainIds.join(","),
      });

      const missingTxContracts = await findMissingTxHashes(
        pool,
        options,
        supportedChainIds,
      );

      if (options.dryRun) {
        logger.info("Dry run results:", {
          totalContracts: missingTxContracts.length,
          sampleContract: missingTxContracts[0]
            ? {
                chainId: missingTxContracts[0].chain_id,
                address: `0x${missingTxContracts[0].address.toString("hex")}`,
              }
            : null,
        });
      } else {
        await insertMissingTxHashes(pool, missingTxContracts);
      }
    } catch (err) {
      logger.error("Script failed", { error: err.message });
      process.exit(1);
    } finally {
      await pool.end();
    }
  });

program.parse(process.argv);
