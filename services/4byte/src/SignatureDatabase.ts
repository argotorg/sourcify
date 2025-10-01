import { Pool } from "pg";
import { SignatureType } from "./utils/signature-util";

export interface SignatureLookupRow {
  signature: string;
}

export interface SignatureSearchRow {
  signature: string;
  signature_hash_4: string;
  signature_hash_32: string;
}

export interface SignatureStatsRow {
  signature_type: SignatureType;
  count: string;
  created_at: Date;
  refreshed_at: Date;
}

export interface SignatureDataProvider {
  getSignatureByHash32AndType(
    hash: Buffer,
    type: SignatureType,
  ): Promise<SignatureLookupRow[]>;
  getSignatureByHash4AndType(
    hash: Buffer,
    type: SignatureType,
  ): Promise<SignatureLookupRow[]>;
  searchSignaturesByPatternAndType(
    pattern: string,
    type: SignatureType,
    limit?: number,
  ): Promise<SignatureSearchRow[]>;
  getSignatureCounts(): Promise<SignatureStatsRow[]>;
}

export interface SignatureDatabaseOptions {
  schema?: string;
}

export class SignatureDatabase implements SignatureDataProvider {
  private readonly schema: string;

  constructor(
    private readonly pool: Pool,
    options: SignatureDatabaseOptions = {},
  ) {
    this.schema = options.schema ?? "public";
  }

  private qualify(table: string): string {
    return `${this.schema}.${table}`;
  }

  async getSignatureByHash32AndType(
    hash: Buffer,
    type: SignatureType,
  ): Promise<SignatureLookupRow[]> {
    const query = `
      SELECT s.signature
      FROM ${this.qualify("signatures")} s
      WHERE s.signature_hash_32 = $1
        AND EXISTS (
          SELECT 1
          FROM ${this.qualify("compiled_contracts_signatures")} ccs
          WHERE ccs.signature_hash_32 = s.signature_hash_32
            AND ccs.signature_type = $2
        )
    `;

    const result = await this.pool.query<SignatureLookupRow>(query, [
      hash,
      type,
    ]);
    return result.rows;
  }

  async getSignatureByHash4AndType(
    hash: Buffer,
    type: SignatureType,
  ): Promise<SignatureLookupRow[]> {
    const query = `
      SELECT s.signature
      FROM ${this.qualify("signatures")} s
      WHERE s.signature_hash_4 = $1
        AND EXISTS (
          SELECT 1
          FROM ${this.qualify("compiled_contracts_signatures")} ccs
          WHERE ccs.signature_hash_32 = s.signature_hash_32
            AND ccs.signature_type = $2
        )
    `;

    const result = await this.pool.query<SignatureLookupRow>(query, [
      hash,
      type,
    ]);
    return result.rows;
  }

  async searchSignaturesByPatternAndType(
    pattern: string,
    type: SignatureType,
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
        concat('0x', encode(s.signature_hash_32, 'hex')) AS signature_hash_32
      FROM ${this.qualify("signatures")} s
      JOIN ${this.qualify("compiled_contracts_signatures")} ccs
        ON s.signature_hash_32 = ccs.signature_hash_32
      WHERE s.signature LIKE $1 ESCAPE '\\'
        AND ccs.signature_type = $2
      LIMIT $3
    `;

    const result = await this.pool.query<SignatureSearchRow>(query, [
      sanitizedPattern,
      type,
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
}
