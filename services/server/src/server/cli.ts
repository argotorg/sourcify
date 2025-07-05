// !!! SHOULD NOT BE IMPORTED IN ANY OTHER MODULES on top of the files
// Module to be run when running the server from the CLI

import path from "path";
// First env vars need to be loaded before config
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });
// Make sure config is relative to index.ts and not where the server is run from
process.env["NODE_CONFIG_DIR"] = path.resolve(__dirname, "..", "config");
import config from "config";
import swaggerUi from "swagger-ui-express";
import yamljs from "yamljs";
import expressSession from "express-session";
import createMemoryStore from "memorystore";
import { Pool } from "pg";
import genFunc from "connect-pg-simple";

// local imports
import logger from "../common/logger";
import { sourcifyChainsMap } from "../sourcify-chains";
import { LibSourcifyConfig, Server } from "./server";
import { SolcLocal } from "./services/compiler/local/SolcLocal";
import session from "express-session";
import { VyperLocal } from "./services/compiler/local/VyperLocal";

// lib-sourcify configuration
const libSourcifyConfig: LibSourcifyConfig = {};
if (process.env.IPFS_GATEWAY || process.env.IPFS_GATEWAY_HEADERS) {
  try {
    libSourcifyConfig.ipfsGateway = {
      url: process.env.IPFS_GATEWAY || "https://ipfs.io/ipfs/",
      headers: JSON.parse(process.env.IPFS_GATEWAY_HEADERS || "{}"),
    };
  } catch (error) {
    logger.error("Error setting lib-sourcify IPFS gateway", { error });
    throw new Error("Error setting lib-sourcify IPFS gateway");
  }
}

if (process.env.RPC_TIMEOUT) {
  try {
    libSourcifyConfig.rpcTimeout = parseInt(process.env.RPC_TIMEOUT);
  } catch (error) {
    logger.error("Error setting lib-sourcify RPC timeout", { error });
    throw new Error("Error setting lib-sourcify RPC timeout");
  }
}

// This variable is used to set the log level for the server and lib-sourcify
const logLevel =
  process.env.NODE_LOG_LEVEL ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

// Solidity Compiler

const solcRepoPath =
  (config.get("solcRepo") as string) || path.join("/tmp", "solc-repo");
const solJsonRepoPath =
  (config.get("solJsonRepo") as string) || path.join("/tmp", "soljson-repo");

logger.info("Using local solidity compiler");
const selectedSolidityCompiler = new SolcLocal(solcRepoPath, solJsonRepoPath);

export const solc = selectedSolidityCompiler;

logger.info("Using local vyper compiler");
const vyperRepoPath =
  (config.get("vyperRepo") as string) || path.join("/tmp", "vyper-repo");
export const vyper = new VyperLocal(vyperRepoPath);

// To print regexes in the config object logs below
Object.defineProperty(RegExp.prototype, "toJSON", {
  value: RegExp.prototype.toString,
});
// Start Server
logger.info("Starting server with config", {
  config: JSON.stringify(config.util.toObject(), null, 2),
});
const server = new Server(
  {
    port: config.get("server.port"),
    maxFileSize: config.get("server.maxFileSize"),
    corsAllowedOrigins: config.get("corsAllowedOrigins"),
    solc,
    vyper,
    chains: sourcifyChainsMap,
    verifyDeprecated: config.get("verifyDeprecated"),
    upgradeContract: config.get("upgradeContract"),
    sessionOptions: getSessionOptions(),
    sourcifyPrivateToken: process.env.SOURCIFY_PRIVATE_TOKEN,
    logLevel,
    libSourcifyConfig,
  },
  {
    initCompilers: config.get("initCompilers") || false,
    sourcifyChainMap: sourcifyChainsMap,
    solcRepoPath,
    solJsonRepoPath,
    vyperRepoPath,
    workerIdleTimeout: process.env.WORKER_IDLE_TIMEOUT
      ? parseInt(process.env.WORKER_IDLE_TIMEOUT)
      : undefined,
    concurrentVerificationsPerWorker: process.env
      .CONCURRENT_VERIFICATIONS_PER_WORKER
      ? parseInt(process.env.CONCURRENT_VERIFICATIONS_PER_WORKER)
      : undefined,
  },
  {
    serverUrl: config.get("serverUrl"),
    enabledServices: {
      read: config.get("storage.read"),
      writeOrWarn: config.get("storage.writeOrWarn"),
      writeOrErr: config.get("storage.writeOrErr"),
    },
    repositoryV1ServiceOptions: {
      repositoryPath: config.get("repositoryV1.path"),
    },
    repositoryV2ServiceOptions: {
      repositoryPath: config.has("repositoryV2.path")
        ? config.get("repositoryV2.path")
        : undefined,
    },
    s3RepositoryServiceOptions: {
      bucket: process.env.S3_BUCKET as string,
      region: process.env.S3_REGION as string,
      accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
      endpoint: process.env.S3_ENDPOINT as string,
    },
    sourcifyDatabaseServiceOptions: {
      postgres: {
        host: process.env.SOURCIFY_POSTGRES_HOST as string,
        database: process.env.SOURCIFY_POSTGRES_DB as string,
        user: process.env.SOURCIFY_POSTGRES_USER as string,
        password: process.env.SOURCIFY_POSTGRES_PASSWORD as string,
        port: parseInt(process.env.SOURCIFY_POSTGRES_PORT || "5432"),
      },
      schema: process.env.SOURCIFY_POSTGRES_SCHEMA as string,
    },
    allianceDatabaseServiceOptions: {
      googleCloudSql: {
        instanceName: process.env
          .ALLIANCE_GOOGLE_CLOUD_SQL_INSTANCE_NAME as string,
        database: process.env.ALLIANCE_GOOGLE_CLOUD_SQL_DATABASE as string,
        user: process.env.ALLIANCE_GOOGLE_CLOUD_SQL_USER as string,
        password: process.env.ALLIANCE_GOOGLE_CLOUD_SQL_PASSWORD as string,
      },
      postgres: {
        host: process.env.ALLIANCE_POSTGRES_HOST as string,
        database: process.env.ALLIANCE_POSTGRES_DB as string,
        user: process.env.ALLIANCE_POSTGRES_USER as string,
        password: process.env.ALLIANCE_POSTGRES_PASSWORD as string,
        port: parseInt(process.env.ALLIANCE_POSTGRES_PORT || "5432"),
      },
      schema: process.env.ALLIANCE_POSTGRES_SCHEMA as string,
    },
  },
);

// Generate the swagger.json and serve it with SwaggerUI at /api-docs
server.services.init().then(() => {
  server
    .loadSwagger(yamljs.load(path.join(__dirname, "..", "openapi.yaml"))) // load the openapi file with the $refs resolved
    .then((swaggerDocument: any) => {
      server.app.get("/api-docs/swagger.json", (req, res) => {
        res.json(swaggerDocument);
      });
      server.app.use(
        "/api-docs",
        swaggerUi.serve,
        swaggerUi.setup(swaggerDocument, {
          customSiteTitle: "Sourcify API",
          customfavIcon: "https://sourcify.dev/favicon.ico",
        }),
      );
      server.app.listen(server.port, () => {
        logger.info("Server listening", { port: server.port });
      });
    });
});

function initMemoryStore() {
  const MemoryStore = createMemoryStore(expressSession);

  logger.warn(
    "Using memory based session. Don't use memory session in production!",
  );
  return new MemoryStore({
    checkPeriod: config.get("session.maxAge"),
  });
}

function initDatabaseStore() {
  const pool = new Pool({
    host: process.env.SOURCIFY_POSTGRES_HOST,
    database: process.env.SOURCIFY_POSTGRES_DB,
    user: process.env.SOURCIFY_POSTGRES_USER,
    password: process.env.SOURCIFY_POSTGRES_PASSWORD,
    port: parseInt(process.env.SOURCIFY_POSTGRES_PORT || "5432"),
  });

  // This listener is necessary otherwise the sourcify process crashes if the database is closed
  pool.prependListener("error", (e) => {
    logger.error("Database connection lost for session pool", {
      error: e,
    });
    throw new Error("Database connection lost for session pool");
  });

  const PostgresqlStore = genFunc(expressSession);

  logger.info("Using database based session");
  return new PostgresqlStore({
    pool: pool,
    // Pruning expired sessions every 12 hours
    pruneSessionInterval: 12 * 60 * 60,
    schemaName: process.env.SOURCIFY_POSTGRES_SCHEMA as string,
  });
}

function getSessionStore() {
  const sessionStoreType = config.get("session.storeType");

  switch (sessionStoreType) {
    case "database": {
      if (
        process.env.SOURCIFY_POSTGRES_HOST &&
        process.env.SOURCIFY_POSTGRES_DB &&
        process.env.SOURCIFY_POSTGRES_USER &&
        process.env.SOURCIFY_POSTGRES_PASSWORD
      ) {
        return initDatabaseStore();
      } else {
        logger.error(
          "Database session enabled in config but the environment variables are not specified",
        );
        throw new Error(
          "Database session enabled in config but the environment variables are not specified",
        );
      }
    }

    case "memory": {
      return initMemoryStore();
    }
    default:
      // Throw an error if an unrecognized session storage type is selected
      throw new Error(
        `Selected session storage type '${sessionStoreType}' doesn't exist.`,
      );
  }
}

export function getSessionOptions(): session.SessionOptions {
  if (config.get("session.secret") === "CHANGE_ME") {
    const msg =
      "The session secret is not set, please set it in the config file";
    process.env.NODE_ENV === "production"
      ? logger.error(msg)
      : logger.warn(msg);
  }
  return {
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
    store: getSessionStore(),
  };
}
