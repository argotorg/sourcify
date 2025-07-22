import rimraf from "rimraf";
import { resetDatabase } from "../helpers/helpers";
import { Server, ServerOptions } from "../../src/server/server";
import config from "config";
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
import { VyperLocal } from "../../src/server/services/compiler/local/VyperLocal";
import path from "path";
import { testS3Bucket, testS3Path } from "./S3ClientMock";
import { SourcifyChainMap } from "@ethereum-sourcify/lib-sourcify";

export type ServerFixtureOptions = {
  port: number;
  read: RWStorageIdentifiers;
  writeOrWarn: StorageIdentifiers[];
  writeOrErr: StorageIdentifiers[];
  skipDatabaseReset: boolean;
  chains: SourcifyChainMap;
};

export class ServerFixture {
  identifier: StorageIdentifiers | undefined;
  readonly maxFileSize: number;
  readonly repositoryV1Path: string;
  readonly testS3Path: string = testS3Path;
  readonly testS3Bucket: string = testS3Bucket;

  private _server?: Server;

  // Getters for type safety
  // Can be safely accessed in "it" blocks
  get sourcifyDatabase(): Pool {
    // sourcifyDatabase is just a shorter way to get databasePool inside SourcifyDatabaseService
    const _sourcifyDatabase = (
      this.server.services.storage.rwServices[
        RWStorageIdentifiers.SourcifyDatabase
      ] as SourcifyDatabaseService
    ).database.pool;
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
        corsAllowedOrigins: config.get<string[]>("corsAllowedOrigins"),
        chains: fixtureOptions_?.chains || sourcifyChainsMap,
        solc: new SolcLocal(config.get("solcRepo"), config.get("solJsonRepo")),
        vyper: new VyperLocal(config.get("vyperRepo")),
        verifyDeprecated: true,
        replaceContract: true,
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
        sourcifyPrivateToken: "sourcify-test-token",
        logLevel: "debug",
      };

      this._server = new Server(
        serverOptions,
        {
          sourcifyChainMap: sourcifyChainsMap,
          solcRepoPath: config.get("solcRepo"),
          solJsonRepoPath: config.get("solJsonRepo"),
          vyperRepoPath: config.get("vyperRepo"),
        },
        {
          serverUrl: config.get("serverUrl"),
          enabledServices: {
            read: fixtureOptions_?.read || config.get("storage.read"),
            writeOrWarn:
              fixtureOptions_?.writeOrWarn || config.get("storage.writeOrWarn"),
            writeOrErr:
              fixtureOptions_?.writeOrErr || config.get("storage.writeOrErr"),
          },
          repositoryV1ServiceOptions: {
            repositoryPath: config.get("repositoryV1.path"),
          },
          repositoryV2ServiceOptions: {
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
          s3RepositoryServiceOptions: {
            bucket: testS3Bucket,
            region: "test-region",
            accessKeyId: "test-key",
            secretAccessKey: "test-secret",
          },
        },
      );

      await this._server.services.init();
      await this.server.listen();
      console.log(`Server listening on port ${this.server.port}!`);
    });

    beforeEach(async () => {
      rimraf.sync(config.get("repositoryV1.path"));
      rimraf.sync(config.get("repositoryV2.path"));
      rimraf.sync(path.join(testS3Path, testS3Bucket, "contracts"));
      if (!fixtureOptions_?.skipDatabaseReset) {
        await resetDatabase(this.sourcifyDatabase);
        console.log("Resetting SourcifyDatabase");
      }
    });

    after(async () => {
      await this.server.shutdown();
      rimraf.sync(config.get("repositoryV1.path"));
      rimraf.sync(config.get("repositoryV2.path"));
      rimraf.sync(path.join(testS3Path, testS3Bucket));
    });
  }
}
