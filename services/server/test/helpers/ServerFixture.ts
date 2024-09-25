import rimraf from "rimraf";
import { resetDatabase } from "../helpers/helpers";
import { Server, ServerOptions } from "../../src/server/server";
import config from "config";
import http from "http";
import { sourcifyChainsMap } from "../../src/sourcify-chains";
import {
  RWStorageIdentifiers,
  StorageIdentifiers,
} from "../../src/server/services/storageServices/identifiers";
import { Pool } from "pg";
import { SourcifyDatabaseService } from "../../src/server/services/storageServices/SourcifyDatabaseService";
import genFunc from "connect-pg-simple";
import expressSession from "express-session";
import { SolcLocal } from "../../src/server/services/compiler/local/SolcLocal";

export type ServerFixtureOptions = {
  port: number;
  read: RWStorageIdentifiers;
  writeOrWarn: StorageIdentifiers[];
  writeOrErr: StorageIdentifiers[];
  skipDatabaseReset: boolean;
};

export class ServerFixture {
  identifier: StorageIdentifiers | undefined;
  readonly maxFileSize: number;
  readonly repositoryV1Path: string;

  private _server?: Server;

  // Getters for type safety
  // Can be safely accessed in "it" blocks
  get sourcifyDatabase(): Pool {
    // sourcifyDatabase is just a shorter way to get databasePool inside SourcifyDatabaseService
    const _sourcifyDatabase = (
      this.server.services.storage.rwServices[
        RWStorageIdentifiers.SourcifyDatabase
      ] as SourcifyDatabaseService
    ).databasePool;
    if (!_sourcifyDatabase)
      throw new Error("sourcifyDatabase not initialized!");
    return _sourcifyDatabase;
  }
  get server(): Server {
    if (!this._server) throw new Error("server not initialized!");
    return this._server;
  }

  /**
   * Creates a server instance for testing with the specified configuration.
   * Expected to be called in a "describe" block.
   * Any tests that may need a different server configuration can be written
   * in a different "describe" block.
   */
  constructor(fixtureOptions_?: Partial<ServerFixtureOptions>) {
    let httpServer: http.Server;
    this.maxFileSize = config.get<number>("server.maxFileSize");
    this.repositoryV1Path = config.get<string>("repositoryV1.path");

    before(async () => {
      process.env.SOURCIFY_POSTGRES_PORT =
        process.env.DOCKER_HOST_POSTGRES_TEST_PORT || "5431";

      if (
        !process.env.SOURCIFY_POSTGRES_HOST ||
        !process.env.SOURCIFY_POSTGRES_DB ||
        !process.env.SOURCIFY_POSTGRES_USER ||
        !process.env.SOURCIFY_POSTGRES_PASSWORD ||
        !process.env.SOURCIFY_POSTGRES_PORT
      ) {
        throw new Error("Not all required environment variables set");
      }
      const PostgresqlStore = genFunc(expressSession);
      const postgresSessionStore = new PostgresqlStore({
        pool: new Pool({
          host: process.env.SOURCIFY_POSTGRES_HOST,
          database: process.env.SOURCIFY_POSTGRES_DB,
          user: process.env.SOURCIFY_POSTGRES_USER,
          password: process.env.SOURCIFY_POSTGRES_PASSWORD,
          port: parseInt(process.env.SOURCIFY_POSTGRES_PORT),
        }),
      });

      const serverOptions: ServerOptions = {
        port: fixtureOptions_?.port || config.get<number>("server.port"),
        maxFileSize: config.get<number>("server.maxFileSize"),
        rateLimit: config.get<{
          enabled: boolean;
          windowMs?: number;
          max?: number;
          whitelist?: string[];
          hideIpInLogs?: boolean;
        }>("rateLimit"),
        corsAllowedOrigins: config.get<string[]>("corsAllowedOrigins"),
        chains: sourcifyChainsMap,
        solc: new SolcLocal(config.get("solcRepo"), config.get("solJsonRepo")),
        verifyDeprecated: config.get("verifyDeprecated"),
        sessionOptions: {
          secret: config.get("session.secret"),
          name: "sourcify_vid",
          rolling: true,
          resave: false,
          saveUninitialized: true,
          cookie: {
            maxAge: config.get("session.maxAge"),
            secure: config.get("session.secure"),
            sameSite: "lax",
          },
          store: postgresSessionStore,
        },
      };

      this._server = new Server(
        serverOptions,
        {
          solcRepoPath: config.get("solcRepo"),
          solJsonRepoPath: config.get("solJsonRepo"),
        },
        {
          enabledServices: {
            read: fixtureOptions_?.read || config.get("storage.read"),
            writeOrWarn:
              fixtureOptions_?.writeOrWarn || config.get("storage.writeOrWarn"),
            writeOrErr:
              fixtureOptions_?.writeOrErr || config.get("storage.writeOrErr"),
          },
          repositoryV1ServiceOptions: {
            ipfsApi: process.env.IPFS_API as string,
            repositoryPath: config.get("repositoryV1.path"),
            repositoryServerUrl: config.get("repositoryV1.serverUrl") as string,
          },
          repositoryV2ServiceOptions: {
            ipfsApi: process.env.IPFS_API as string,
            repositoryPath: config.get("repositoryV2.path"),
          },
          sourcifyDatabaseServiceOptions: {
            postgres: {
              host: process.env.SOURCIFY_POSTGRES_HOST as string,
              database: process.env.SOURCIFY_POSTGRES_DB as string,
              user: process.env.SOURCIFY_POSTGRES_USER as string,
              password: process.env.SOURCIFY_POSTGRES_PASSWORD as string,
              port: parseInt(process.env.SOURCIFY_POSTGRES_PORT),
            },
          },
        },
      );

      await this._server.services.init();

      await new Promise<void>((resolve, reject) => {
        httpServer = this.server.app.listen(this.server.port, resolve);
        httpServer.on("error", reject);
      });
      console.log(`Server listening on port ${this.server.port}!`);
    });

    beforeEach(async () => {
      rimraf.sync(config.get("repositoryV1.path"));
      rimraf.sync(config.get("repositoryV2.path"));
      if (!fixtureOptions_?.skipDatabaseReset) {
        await resetDatabase(this.sourcifyDatabase);
        console.log("Resetting SourcifyDatabase");
      }
    });

    after(() => {
      httpServer.close();
      rimraf.sync(config.get("repositoryV1.path"));
      rimraf.sync(config.get("repositoryV2.path"));
    });
  }
}
