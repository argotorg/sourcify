import { Pool } from "pg";
import { FourByteServer } from "../../src/FourByteServer";
import { id as keccak256str } from "ethers";
import { SignatureType } from "../../src/utils/signature-util";

export interface TestSignature {
  signature: string;
  type?: SignatureType;
}

export type FourByteServerFixtureOptions = {
  port?: number;
  skipDatabaseReset?: boolean;
};

export class FourByteServerFixture {
  private _server?: FourByteServer;
  private _pool?: Pool;
  readonly port: number;

  // Getters for type safety
  get server(): FourByteServer {
    if (!this._server) throw new Error("4byte server not initialized!");
    return this._server;
  }

  get pool(): Pool {
    if (!this._pool) throw new Error("Database pool not initialized!");
    return this._pool;
  }

  constructor(fixtureOptions?: FourByteServerFixtureOptions) {
    this.port = fixtureOptions?.port || 4445;

    before(async () => {
      // Seperate connection to initialize or reset the database
      this._pool = new Pool({
        host: process.env.FOURBYTES_POSTGRES_HOST || "localhost",
        port: parseInt(process.env.FOURBYTES_POSTGRES_PORT || "5433"),
        database: process.env.FOURBYTES_POSTGRES_DB || "fourbytes_test",
        user: process.env.FOURBYTES_POSTGRES_USER || "fourbytes",
        password: process.env.FOURBYTES_POSTGRES_PASSWORD || "fourbytes",
      });

      // Create server instance
      this._server = new FourByteServer({
        port: this.port,
        databaseConfig: {
          host: process.env.FOURBYTES_POSTGRES_HOST || "localhost",
          port: parseInt(process.env.FOURBYTES_POSTGRES_PORT || "5433"),
          database: process.env.FOURBYTES_POSTGRES_DB || "fourbytes_test",
          user: process.env.FOURBYTES_POSTGRES_USER || "fourbytes",
          password: process.env.FOURBYTES_POSTGRES_PASSWORD || "fourbytes",
          max: 20,
          schema: process.env.FOURBYTES_POSTGRES_SCHEMA || "public",
        },
      });

      // Start the server
      await this.server.listen();
      console.log(`4byte server listening on port ${this.port}!`);
    });

    beforeEach(async () => {
      if (!fixtureOptions?.skipDatabaseReset) {
        await this.resetDatabase();
        await this.insertTestSignatures(FourByteServerFixture.testSignatures);
        console.log("Resetting 4byte database");
      }
    });

    after(async () => {
      if (this._server) {
        await this.server.shutdown();
      }
      if (this._pool) {
        await this._pool.end();
      }
    });
  }

  async resetDatabase(): Promise<void> {
    if (!this._pool) return;

    await this._pool.query(
      "TRUNCATE signatures, compiled_contracts_signatures RESTART IDENTITY CASCADE",
    );

    // Refresh the materialized view to clear stats
    try {
      await this._pool.query("REFRESH MATERIALIZED VIEW signature_stats");
    } catch (error) {
      // Ignore errors if the materialized view doesn't exist yet
      console.log(
        "Could not refresh signature stats (materialized view may not exist yet)",
      );
    }
  }

  async insertTestSignatures(signatures: TestSignature[]): Promise<void> {
    if (!this._pool) throw new Error("Database pool not initialized!");

    const client = await this._pool.connect();

    try {
      await client.query("BEGIN");

      // Drop the foreign key constraint to be able to insert mock data
      await client.query(
        "ALTER TABLE compiled_contracts_signatures DROP CONSTRAINT IF EXISTS compiled_contracts_signatures_compilation_id_fkey;",
      );

      // Insert signatures
      for (const sig of signatures) {
        const hash32 = keccak256str(sig.signature);
        const hash32Buffer = Buffer.from(hash32.slice(2), "hex");

        // Insert signature
        await client.query(
          "INSERT INTO signatures (signature, signature_hash_32) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [sig.signature, hash32Buffer],
        );

        if (sig.type) {
          // Insert compiled contract signature with mock compilation_id
          const mockCompilationId = `00000000-0000-0000-0000-${hash32.slice(2, 14)}`;
          await client.query(
            "INSERT INTO compiled_contracts_signatures (compilation_id, signature_hash_32, signature_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            [mockCompilationId, hash32Buffer, sig.type],
          );
        }
      }

      // Refresh the materialized view for stats
      try {
        await client.query("REFRESH MATERIALIZED VIEW signature_stats");
      } catch (error) {
        // Ignore errors if the materialized view doesn't exist or can't be refreshed
        console.log(
          "Could not refresh signature stats materialized view:",
          error,
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // Predefined test signatures
  static readonly testSignatures: TestSignature[] = [
    { signature: "transfer(address,uint256)", type: SignatureType.Function },
    // Collusion with transfer(address,uint256)
    {
      signature: "_____$_$__$___$$$___$$___$__$$(address,uint256)",
      type: SignatureType.Function,
    },
    { signature: "approve(address,uint256)", type: SignatureType.Function },
    { signature: "balanceOf(address)", type: SignatureType.Function },
    {
      signature: "transferFrom(address,address,uint256)",
      type: SignatureType.Function,
    },
    { signature: "test_underscore()", type: SignatureType.Function },
    { signature: "testtunderscore()", type: SignatureType.Function },
    { signature: "funcWithoutType()" },
    { signature: "bothEventAndFunc()", type: SignatureType.Function },
    { signature: "bothEventAndFunc()", type: SignatureType.Event },
    { signature: "allowance(address,address)", type: SignatureType.Function },
    {
      signature: "Transfer(address,address,uint256)",
      type: SignatureType.Event,
    },
    {
      signature: "Approval(address,address,uint256)",
      type: SignatureType.Event,
    },
    {
      signature: "InsufficientBalance(uint256,uint256)", // Error signature but we classify it as a function signature
      type: SignatureType.Function,
    },
    { signature: "UnauthorizedAccess(address)", type: SignatureType.Function }, // Error signature but we classify it as a function signature
  ];
}
