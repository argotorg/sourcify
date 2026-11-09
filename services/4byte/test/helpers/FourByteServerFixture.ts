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

export interface TestVerifiedContract {
  name: string;
  chainId: number;
  address: string;
  signatures: TestSignature[];
}

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
        // Count up to now. Tests call server.stats.reset() after they change the database.
        statsOptions: { commitMarginMs: 0, countStepMs: 1 },
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
      "TRUNCATE signatures, compiled_contracts_signatures, verified_contracts, compiled_contracts, contract_deployments, contracts, code RESTART IDENTITY CASCADE",
    );
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

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // Stores a minimal verified contract and its signatures in one transaction, as the
  // server does after a verification.
  async insertVerifiedContract(contract: TestVerifiedContract): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Unique code for each contract, because of the unique keys on the code hashes
      const code = Buffer.from(contract.address.slice(2), "hex");
      const {
        rows: [{ code_hash: codeHash }],
      } = await client.query(
        "INSERT INTO code (code_hash, code_hash_keccak, code) VALUES (digest($1::bytea, 'sha256'), '\\x', $1) RETURNING code_hash",
        [code],
      );
      const {
        rows: [{ id: contractId }],
      } = await client.query(
        "INSERT INTO contracts (creation_code_hash, runtime_code_hash) VALUES ($1, $1) RETURNING id",
        [codeHash],
      );
      const {
        rows: [{ id: deploymentId }],
      } = await client.query(
        "INSERT INTO contract_deployments (chain_id, address, contract_id) VALUES ($1, $2, $3) RETURNING id",
        [
          contract.chainId,
          Buffer.from(contract.address.slice(2), "hex"),
          contractId,
        ],
      );
      const {
        rows: [{ id: compilationId }],
      } = await client.query(
        `INSERT INTO compiled_contracts (compiler, version, language, name, fully_qualified_name, compiler_settings,
           compilation_artifacts, creation_code_hash, creation_code_artifacts, runtime_code_hash, runtime_code_artifacts)
         VALUES ('solc', '0.8.0', 'solidity', $1, $2, '{}', '{"abi":[],"sources":{}}', $3,
           '{"sourceMap":"","linkReferences":{}}', $3, '{"sourceMap":"","linkReferences":{},"immutableReferences":{}}')
         RETURNING id`,
        [contract.name, `${contract.name}.sol:${contract.name}`, codeHash],
      );
      await client.query(
        `INSERT INTO verified_contracts (deployment_id, compilation_id, creation_match, runtime_match,
           runtime_values, runtime_transformations, runtime_metadata_match)
         VALUES ($1, $2, false, true, '{}', '[]', true)`,
        [deploymentId, compilationId],
      );
      for (const sig of contract.signatures) {
        const hash32 = Buffer.from(keccak256str(sig.signature).slice(2), "hex");
        await client.query(
          "INSERT INTO signatures (signature, signature_hash_32) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [sig.signature, hash32],
        );
        await client.query(
          "INSERT INTO compiled_contracts_signatures (compilation_id, signature_hash_32, signature_type) VALUES ($1, $2, $3)",
          [compilationId, hash32, sig.type ?? SignatureType.Function],
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
