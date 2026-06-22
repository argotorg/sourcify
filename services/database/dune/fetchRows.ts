// conflict between prettier and eslint
import dotenv from "dotenv";
import pg from "pg";
import type {
  PgCode,
  PgCompiledContract,
  PgCompiledContractsSource,
  PgContract,
  PgContractDeployment,
  PgSource,
  PgSourcifyMatch,
  PgVerifiedContract,
} from "../pg-types";

dotenv.config();
const { Pool } = pg;

// Validate environment variables
if (
  !process.env.POSTGRES_HOST ||
  !process.env.POSTGRES_PORT ||
  !process.env.POSTGRES_USER ||
  !process.env.POSTGRES_DB ||
  !process.env.POSTGRES_PASSWORD
) {
  console.error(
    "Create a .env file containing all the needed environment variables for the database connection",
  );
  process.exit(2);
}

// Create a pool factory to avoid code duplication
function createPool() {
  return new Pool({
    host: process.env.POSTGRES_HOST!,
    port: parseInt(process.env.POSTGRES_PORT!),
    user: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!,
    database: process.env.POSTGRES_DB!,
  });
}

async function fetchWithQuery(table: string, customQuery?: string) {
  const pool = createPool();
  const defaultQuery = `
    SELECT *
    FROM ${table}
    LIMIT 1
  `;

  const queryToUse = customQuery || defaultQuery;
  try {
    const result = await pool.query(queryToUse);

    if (result.rows.length === 0) {
      console.log(`No ${table} found`);
      return null;
    }

    return result.rows;
  } catch (error) {
    console.error(`Error fetching ${table}:`, error);
    throw error;
  } finally {
    await pool.end();
  }
}

export async function fetchCode(
  code_hash: Buffer = Buffer.from("00", "hex"),
  pageSize: number,
): Promise<PgCode[] | null> {
  return fetchWithQuery(
    "code",
    `SELECT * FROM code WHERE code_hash > decode('${code_hash.toString("hex")}', 'hex') ORDER BY code_hash ASC LIMIT ${pageSize}`,
  );
}

export async function fetchCompiledContracts(
  id: string = "00000000-0000-0000-0000-000000000000",
  pageSize: number,
): Promise<PgCompiledContract[] | null> {
  // exclude compiled_contracts.sources
  const query = `
      SELECT
        id,
        created_at,
        updated_at,
        created_by,
        updated_by,
        compiler,
        version,
        language,
        name,
        fully_qualified_name,
        compiler_settings,
        compilation_artifacts,
        creation_code_hash,
        creation_code_artifacts,
        runtime_code_hash,
        runtime_code_artifacts
      FROM compiled_contracts
      WHERE id > '${id}'
      ORDER BY id ASC
      LIMIT ${pageSize}
    `;
  return fetchWithQuery("compiled_contracts", query);
}

export async function fetchCompiledContractsSources(
  id: string = "00000000-0000-0000-0000-000000000000",
  pageSize: number,
): Promise<PgCompiledContractsSource[] | null> {
  return fetchWithQuery(
    "compiled_contracts_sources",
    `SELECT * FROM compiled_contracts_sources WHERE id > '${id}' ORDER BY id ASC LIMIT ${pageSize}`,
  );
}

export async function fetchContractDeployments(
  id: string = "00000000-0000-0000-0000-000000000000",
  pageSize: number,
): Promise<PgContractDeployment[] | null> {
  return fetchWithQuery(
    "contract_deployments",
    `SELECT * FROM contract_deployments WHERE id > '${id}' ORDER BY id ASC LIMIT ${pageSize}`,
  );
}

export async function fetchContracts(
  id: string = "00000000-0000-0000-0000-000000000000",
  pageSize: number,
): Promise<PgContract[] | null> {
  return fetchWithQuery(
    "contracts",
    `SELECT * FROM contracts WHERE id > '${id}' ORDER BY id ASC LIMIT ${pageSize}`,
  );
}

export async function fetchSources(
  source_hash: Buffer = Buffer.from("00", "hex"),
  pageSize: number,
): Promise<PgSource[] | null> {
  return fetchWithQuery(
    "sources",
    `SELECT * FROM sources WHERE source_hash > decode('${source_hash.toString("hex")}', 'hex') ORDER BY source_hash ASC LIMIT ${pageSize}`,
  );
}

export async function fetchVerifiedContracts(
  lastValue: number = 0,
  pageSize: number,
): Promise<PgVerifiedContract[] | null> {
  return fetchWithQuery(
    "verified_contracts",
    `SELECT * FROM verified_contracts WHERE id > ${lastValue} ORDER BY id ASC LIMIT ${pageSize}`,
  );
}

export async function fetchSourcifyMatches(
  lastValue: number = 0,
  pageSize: number,
): Promise<PgSourcifyMatch[] | null> {
  return fetchWithQuery(
    "sourcify_matches",
    `SELECT * FROM sourcify_matches WHERE id > ${lastValue} ORDER BY id ASC LIMIT ${pageSize}`,
  );
}

/**
 * Count the total number of rows in a table
 * @param table - The name of the table to count the rows of
 * @returns The total number of rows in the table, or null if there is an error
 */
export async function countTotalRows(table: string): Promise<number | null> {
  const result = await fetchWithQuery(
    `counting ${table}`,
    `SELECT COUNT(*) FROM ${table}`,
  );
  if (!result) {
    return null;
  }
  return result[0].count;
}
