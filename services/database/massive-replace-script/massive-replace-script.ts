import pg from "pg";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

interface ReplaceConfig {
  query: (
    sourcePool: pg.Pool,
    sourcifySchema: string,
    currentVerifiedContract: number,
    n: number,
  ) => Promise<pg.QueryResult>;
  buildRequestBody: (contract: any) => any;
  description?: string;
}

const CURRENT_VERIFIED_CONTRACT_PATH =
  process.env.CURRENT_VERIFIED_CONTRACT_PATH || __dirname;

const { Pool } = pg;

// Load current verified contract counter from file
const COUNTER_FILE = path.join(
  CURRENT_VERIFIED_CONTRACT_PATH,
  "CURRENT_VERIFIED_CONTRACT",
);
let CURRENT_VERIFIED_CONTRACT = 1;
if (fs.existsSync(COUNTER_FILE)) {
  CURRENT_VERIFIED_CONTRACT = parseInt(
    fs.readFileSync(COUNTER_FILE, "utf8"),
    10,
  );
}

// Optional failed contracts storage
const STORE_FAILED_CONTRACT_IDS =
  process.env.STORE_FAILED_CONTRACT_IDS === "true";
const FAILED_CONTRACTS_FILE = path.join(
  CURRENT_VERIFIED_CONTRACT_PATH,
  "FAILED_CONTRACTS",
);

function storeFailedContract(contract: any, error: any): void {
  if (!STORE_FAILED_CONTRACT_IDS) return;

  const address = `0x${contract.address.toString("hex")}`;
  const failedContractInfo = {
    timestamp: new Date().toISOString(),
    verifiedContractId: contract.verified_contract_id,
    chainId: contract.chain_id,
    address: address,
    error: error.message || error.toString(),
  };

  const logEntry = JSON.stringify(failedContractInfo) + "\n";

  try {
    fs.appendFileSync(FAILED_CONTRACTS_FILE, logEntry, "utf8");
  } catch (writeError) {
    console.error("Error writing to failed contracts file:", writeError);
  }
}

const N = 5; // Number of contracts to process at a time

const POSTGRES_SCHEMA = process.env.POSTGRES_SCHEMA || "public";

const SOURCE_DB_CONFIG = {
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT
    ? parseInt(process.env.POSTGRES_PORT, 10)
    : undefined,
};

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5555";
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN;

if (!API_AUTH_TOKEN) {
  throw new Error("API_AUTH_TOKEN is not set");
}

const CONFIG_FILE_PATH = process.env.CONFIG_FILE_PATH!;

if (!CONFIG_FILE_PATH) {
  throw new Error("CONFIG_FILE_PATH is not set");
}

function loadConfiguration(): ReplaceConfig {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const configModule = require(CONFIG_FILE_PATH);
    return configModule;
  } catch (error) {
    console.error("Error loading configuration file:", error);
    throw new Error("Failed to load configuration");
  }
}

async function callReplaceContractAPI(requestBody: any): Promise<any> {
  const url = `${API_BASE_URL}/private/replace-contract`;

  if (!API_AUTH_TOKEN) {
    throw new Error("API_AUTH_TOKEN is not set");
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_AUTH_TOKEN}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API call failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return await response.json();
  } catch (error) {
    console.error("Error calling replace-contract API:", error);
    throw error;
  }
}

async function processContract(
  contract: any,
  config: ReplaceConfig,
): Promise<void> {
  const address = `0x${contract.address.toString("hex")}`;
  try {
    console.log(
      `Processing contract: chainId=${contract.chain_id}, address=${address}, verifiedContractId=${contract.verified_contract_id}`,
    );

    const requestBody = config.buildRequestBody(contract);
    const result = await callReplaceContractAPI(requestBody);

    console.log(`✅ Successfully processed contract ${address}:`, result);
  } catch (error) {
    console.error(
      `❌ Failed to process contract ${address} at chain ${contract.chain_id}:`,
      error,
    );
    storeFailedContract(contract, error);
    throw error;
  }
}

(async () => {
  // Load configuration
  const config = loadConfiguration();
  console.log(
    `Using configuration: ${config.description || "Custom replacement"}`,
  );

  if (STORE_FAILED_CONTRACT_IDS) {
    console.log(`Failed contracts will be stored in: ${FAILED_CONTRACTS_FILE}`);
  }

  // Connect to source DB using a Pool
  const sourcePool = new Pool(SOURCE_DB_CONFIG);
  sourcePool.on("error", (err) => {
    console.error("Unexpected error on idle source client", err);
    process.exit(-1);
  });

  try {
    // Process contracts
    let verifiedContractCount = 1;
    while (verifiedContractCount > 0) {
      const startIterationTime = performance.now();

      console.log(`Processing next ${N} contracts`);
      console.log(`Current contract id: ${CURRENT_VERIFIED_CONTRACT}`);

      // Use the query from configuration
      const { rows: verifiedContracts, rowCount } = await config.query(
        sourcePool,
        POSTGRES_SCHEMA,
        CURRENT_VERIFIED_CONTRACT,
        N,
      );

      verifiedContractCount = rowCount || 0;

      let secondToWait = 2;
      // Process the batch in parallel
      const processingPromises = verifiedContracts.map((contract) =>
        processContract(contract, config),
      );
      const results = await Promise.allSettled(processingPromises);
      for (const result of results) {
        if (result.status === "rejected") {
          secondToWait = 5; // Increase wait time on error
        }
      }

      // Update the counter file only after the batch successfully completes

      const lastProcessedId =
        verifiedContracts[verifiedContracts.length - 1].verified_contract_id;
      CURRENT_VERIFIED_CONTRACT = parseInt(lastProcessedId) + 1;

      // Use async write to avoid blocking
      fs.writeFile(
        COUNTER_FILE,
        CURRENT_VERIFIED_CONTRACT.toString(),
        "utf8",
        (err) => {
          if (err) {
            console.error("Error writing counter file:", err);
          }
        },
      );

      console.log(`waiting ${secondToWait} seconds`);
      await new Promise((resolve) => setTimeout(resolve, secondToWait * 1000));

      const endIterationTime = performance.now();
      const iterationTimeTaken = endIterationTime - startIterationTime;
      console.log(
        `Rate: processing ${
          N / (iterationTimeTaken / 1000)
        } contracts per second`,
      );
    }
    console.log("Contracts processed successfully.");
  } catch (error) {
    console.error("Error processing contracts:", error);
  } finally {
    // End the pool
    if (sourcePool) await sourcePool.end();
  }
})();
