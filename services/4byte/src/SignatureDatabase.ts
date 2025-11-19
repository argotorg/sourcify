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

export interface SignatureStatsRow {
  signature_type: SignatureType;
  count: string;
  refreshed_at: Date;
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

  async getSignatureCounts(): Promise<SignatureStatsRow[]> {
    const query = `
      SELECT
        signature_type,
        count::text,
        refreshed_at
      FROM ${this.qualify("signature_stats")}
      ORDER BY signature_type
    `;

    const result = await this.pool.query<SignatureStatsRow>(query);
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
