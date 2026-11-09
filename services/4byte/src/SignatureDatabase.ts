import { Pool } from "pg";
import { id as keccak256str } from "ethers";
import type { SignatureType } from "./utils/signature-util";
import type { DatabaseConfig } from "./FourByteServer";
import logger from "./logger";

export interface SignatureLookupRow {
  signature: string;
  has_verified_contract: boolean;
}

export interface SignatureSearchRow {
  signature: string;
  signature_hash_4: string;
  signature_hash_32: string;
  has_verified_contract: boolean;
}

export interface SignatureCountsSince {
  total: number;
  function: number;
  event: number;
  error: number;
  unknown: number;
}

export interface RecentSignatureRow {
  signature: string;
  signature_hash_4: string;
  signature_hash_32: string;
  // ISO 8601 with microseconds, so that it can be a cursor without loss
  created_at: string;
  types: SignatureType[];
  contract_name: string | null;
  chain_id: string | null;
  address: string | null;
}

export interface RecentSignaturesCursor {
  createdAt: string;
  signatureHash32: Buffer;
}

export interface SignatureInsertResult {
  signature: string;
  signature_hash_4: string;
  signature_hash_32: string;
  was_inserted: boolean;
}

export interface SignatureDatabaseOptions {
  schema?: string;
}

export class SignatureDatabase {
  private readonly schema: string;
  private readonly pool: Pool;

  constructor(databaseConfig: DatabaseConfig) {
    this.schema = databaseConfig.schema ?? "public";
    this.pool = new Pool({
      host: databaseConfig.host,
      port: databaseConfig.port,
      database: databaseConfig.database,
      user: databaseConfig.user,
      password: databaseConfig.password,
      max: databaseConfig.max,
    });
  }

  private qualify(table: string): string {
    return `${this.schema}.${table}`;
  }

  async getSignatureByHash32(hash: Buffer): Promise<SignatureLookupRow[]> {
    const query = `
      SELECT
        s.signature,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM ${this.qualify("compiled_contracts_signatures")} ccs
            WHERE ccs.signature_hash_32 = s.signature_hash_32
          ) THEN true
          ELSE false
        END as has_verified_contract
      FROM ${this.qualify("signatures")} s
      WHERE s.signature_hash_32 = $1
    `;

    const result = await this.pool.query<SignatureLookupRow>(query, [hash]);
    return result.rows;
  }

  async getSignatureByHash4(hash: Buffer): Promise<SignatureLookupRow[]> {
    const query = `
      SELECT
        s.signature,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM ${this.qualify("compiled_contracts_signatures")} ccs
            WHERE ccs.signature_hash_32 = s.signature_hash_32
          ) THEN true
          ELSE false
        END as has_verified_contract
      FROM ${this.qualify("signatures")} s
      WHERE s.signature_hash_4 = $1
    `;

    const result = await this.pool.query<SignatureLookupRow>(query, [hash]);
    return result.rows;
  }

  async searchSignaturesByPattern(
    pattern: string,
    limit = 100,
  ): Promise<SignatureSearchRow[]> {
    const sanitizedPattern = pattern
      .trim()
      .replace(/_/g, "\\_")
      .replace(/\*/g, "%")
      .replace(/\?/g, "_");

    const query = `
      SELECT DISTINCT
        s.signature,
        concat('0x', encode(s.signature_hash_4, 'hex')) AS signature_hash_4,
        concat('0x', encode(s.signature_hash_32, 'hex')) AS signature_hash_32,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM ${this.qualify("compiled_contracts_signatures")} ccs
            WHERE ccs.signature_hash_32 = s.signature_hash_32
          ) THEN true
          ELSE false
        END as has_verified_contract
      FROM ${this.qualify("signatures")} s
      WHERE s.signature LIKE $1 ESCAPE '\\'
      LIMIT $2
    `;

    const result = await this.pool.query<SignatureSearchRow>(query, [
      sanitizedPattern,
      limit,
    ]);
    return result.rows;
  }

  // Counts the signatures with after < created_at <= until, by type. The types come from all
  // current usages, so a signature that is first imported and then found in a verified
  // contract counts with its type. This does one index lookup in
  // compiled_contracts_signatures for each new signature. On production it takes about
  // 0.2 s for 2 hours of signatures and 8 s for 1 day.
  async countSignaturesBetween(
    after: Date,
    until: Date,
  ): Promise<SignatureCountsSince> {
    const query = `
      SELECT
        COUNT(*)::text AS total,
        (COUNT(*) FILTER (WHERE 'function' = ANY(u.types)))::text AS function,
        (COUNT(*) FILTER (WHERE 'event' = ANY(u.types)))::text AS event,
        (COUNT(*) FILTER (WHERE 'error' = ANY(u.types)))::text AS error,
        (COUNT(*) FILTER (WHERE u.types IS NULL))::text AS unknown
      FROM ${this.qualify("signatures")} s
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT ccs.signature_type::text) AS types
        FROM ${this.qualify("compiled_contracts_signatures")} ccs
        WHERE ccs.signature_hash_32 = s.signature_hash_32
      ) u ON true
      WHERE s.created_at > $1 AND s.created_at <= $2
    `;
    const result = await this.pool.query<Record<string, string>>(query, [
      after,
      until,
    ]);
    const row = result.rows[0];
    return {
      total: parseInt(row.total, 10),
      function: parseInt(row.function, 10),
      event: parseInt(row.event, 10),
      error: parseInt(row.error, 10),
      unknown: parseInt(row.unknown, 10),
    };
  }

  // Counts the signatures with after < created_at <= until. Reads only the
  // signatures_created_at index.
  async countAllSignaturesBetween(after: Date, until: Date): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${this.qualify("signatures")} WHERE created_at > $1 AND created_at <= $2`,
      [after, until],
    );
    return parseInt(result.rows[0].total, 10);
  }

  // Counts the signatures with created_at <= until. This reads the whole
  // signatures_created_at index, so call it rarely.
  async countSignaturesUntil(until: Date): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${this.qualify("signatures")} WHERE created_at <= $1`,
      [until],
    );
    return parseInt(result.rows[0].total, 10);
  }

  // Signatures with created_at >= since, oldest first. The cursor is the last row of
  // the previous page: many signatures can have the same created_at (one transaction).
  // The source is one verified contract that uses the signature. It prefers the usage
  // that was stored in the same transaction as the signature, which is the contract
  // whose verification added the signature.
  async getRecentSignatures(
    since: string,
    cursor: RecentSignaturesCursor | undefined,
    limit: number,
  ): Promise<RecentSignatureRow[]> {
    const query = `
      WITH recent AS (
        SELECT s.signature, s.signature_hash_4, s.signature_hash_32, s.created_at
        FROM ${this.qualify("signatures")} s
        WHERE s.created_at >= $1::timestamptz
          AND ($2::timestamptz IS NULL OR (s.created_at, s.signature_hash_32) > ($2::timestamptz, $3::bytea))
        ORDER BY s.created_at, s.signature_hash_32
        LIMIT $4
      )
      SELECT
        r.signature,
        concat('0x', encode(r.signature_hash_4, 'hex')) AS signature_hash_4,
        concat('0x', encode(r.signature_hash_32, 'hex')) AS signature_hash_32,
        to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
        COALESCE(types.types, '{}') AS types,
        source.contract_name,
        source.chain_id::text AS chain_id,
        CASE WHEN source.address IS NULL THEN NULL
          ELSE concat('0x', encode(source.address, 'hex')) END AS address
      FROM recent r
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT ccs.signature_type::text ORDER BY ccs.signature_type::text) AS types
        FROM ${this.qualify("compiled_contracts_signatures")} ccs
        WHERE ccs.signature_hash_32 = r.signature_hash_32
      ) types ON true
      LEFT JOIN LATERAL (
        SELECT cc.name AS contract_name, cd.chain_id, cd.address
        FROM ${this.qualify("compiled_contracts_signatures")} ccs
        JOIN ${this.qualify("verified_contracts")} vc ON vc.compilation_id = ccs.compilation_id
        JOIN ${this.qualify("contract_deployments")} cd ON cd.id = vc.deployment_id
        JOIN ${this.qualify("compiled_contracts")} cc ON cc.id = ccs.compilation_id
        WHERE ccs.signature_hash_32 = r.signature_hash_32
        ORDER BY (ccs.created_at = r.created_at) DESC, vc.id DESC
        LIMIT 1
      ) source ON true
      ORDER BY r.created_at, r.signature_hash_32
    `;
    const result = await this.pool.query<RecentSignatureRow>(query, [
      since,
      cursor?.createdAt ?? null,
      cursor?.signatureHash32 ?? null,
      limit,
    ]);
    return result.rows;
  }

  async checkDatabaseHealth(): Promise<void> {
    // Checking pool health before continuing
    try {
      logger.debug("Checking database pool health for 4byte service");
      await this.pool.query("SELECT 1;");
      logger.info("Database connection healthy", {
        host: this.pool.options.host,
        port: this.pool.options.port,
        database: this.pool.options.database,
        user: this.pool.options.user,
      });
    } catch (error) {
      logger.error("Cannot connect to 4byte database", {
        host: this.pool.options.host,
        port: this.pool.options.port,
        database: this.pool.options.database,
        user: this.pool.options.user,
        error,
      });
      throw new Error("Cannot connect to 4byte database");
    }
  }

  async insertSignatures(
    signatures: string[],
  ): Promise<SignatureInsertResult[]> {
    const MAX_BATCH_SIZE = 1000;

    if (signatures.length === 0) {
      return [];
    }

    if (signatures.length > MAX_BATCH_SIZE) {
      throw new Error(
        `Too many signatures. Maximum ${MAX_BATCH_SIZE} signatures allowed per batch.`,
      );
    }

    // Pre-calculate all hashes client-side
    const signatureData = signatures.map((signature) => {
      const hash32 = keccak256str(signature);
      const hash4 = hash32.slice(0, 10);
      return {
        signature,
        hash32,
        hash4,
      };
    });

    const valueIndexes: string[] = [];
    const queryValues: string[] = [];

    signatureData.forEach((_, index) => {
      const baseIndex = index * 2 + 1;
      valueIndexes.push(
        `($${baseIndex}, decode(substring($${baseIndex + 1}, 3), 'hex'))`,
      );
    });

    signatureData.forEach(({ signature, hash32 }) => {
      queryValues.push(signature, hash32);
    });

    const query = `
      INSERT INTO ${this.qualify("signatures")} (signature, signature_hash_32)
      VALUES ${valueIndexes.join(", ")}
      ON CONFLICT (signature_hash_32) DO NOTHING
      RETURNING signature,
                concat('0x', encode(signature_hash_4, 'hex')) AS signature_hash_4,
                concat('0x', encode(signature_hash_32, 'hex')) AS signature_hash_32
    `;

    try {
      const result = await this.pool.query(query, queryValues);
      const insertedRows = new Set(result.rows.map((row) => row.signature));

      // Build results array matching input order
      return signatureData.map(({ signature, hash4, hash32 }) => ({
        signature,
        signature_hash_4: hash4,
        signature_hash_32: hash32,
        was_inserted: insertedRows.has(signature),
      }));
    } catch (error) {
      logger.error("Error in batch signature insert", {
        error,
        signatureCount: signatures.length,
      });
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
