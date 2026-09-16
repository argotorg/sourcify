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

// local imports
import logger from "../common/logger";
import { initializeSourcifyChains } from "../sourcify-chains";
import type { SourcifyChainMap } from "@ethereum-sourcify/lib-sourcify";
import type { LibSourcifyConfig } from "./server";
import { Server } from "./server";
import { SolcLocal } from "./services/compiler/local/SolcLocal";
import { VyperLocal } from "./services/compiler/local/VyperLocal";
import { FeLocal } from "./services/compiler/local/FeLocal";
import type { RuntimeStatsOptions } from "./services/utils/RuntimeStats";

export const getEtherscanApiKeyForEachChain = (
  chainsMap: SourcifyChainMap,
): Record<string, string> =>
  Object.entries(chainsMap).reduce<Record<string, string>>(
    (acc, [chainId, { supported, etherscanApi }]) => {
      const envName = supported ? etherscanApi?.apiKeyEnvName : undefined;
      const value = envName ? process.env[envName] : undefined;
      if (value) acc[chainId] = value;
      return acc;
    },
    {},
  );

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

const readNumberEnv = (name: string, defaultValue: number): number => {
  const value = process.env[name] ? Number(process.env[name]) : NaN;
  if (Number.isNaN(value)) {
    return defaultValue;
  }
  return value;
};

// Wall-clock limit for a single compiler subprocess. Left undefined the
// compilers package applies its own default.
const compilerTimeoutMs = process.env.COMPILER_TIMEOUT_MS
  ? parseInt(process.env.COMPILER_TIMEOUT_MS)
  : undefined;
// Same value as DEFAULT_COMPILE_TIMEOUT_MS of @ethereum-sourcify/compilers
const DEFAULT_COMPILER_TIMEOUT_MS = 2_700_000;
const effectiveCompilerTimeoutMs =
  compilerTimeoutMs ?? DEFAULT_COMPILER_TIMEOUT_MS;

// Wall-clock limit for one worker task. The compiler timeout only bounds
// the compiler subprocess; this bounds everything else that runs on the
// worker thread. It must stay above the compiler timeout so that a slow
// compile fails with compiler_timeout and not with job_timeout. 0 disables.
const workerTaskTimeoutMs = readNumberEnv(
  "WORKER_TASK_TIMEOUT_MS",
  effectiveCompilerTimeoutMs + 15 * 60 * 1000,
);
if (
  workerTaskTimeoutMs > 0 &&
  workerTaskTimeoutMs <= effectiveCompilerTimeoutMs
) {
  logger.warn(
    "WORKER_TASK_TIMEOUT_MS is not larger than the compiler timeout, slow compilations will fail with job_timeout instead of compiler_timeout",
    { workerTaskTimeoutMs, compilerTimeoutMs: effectiveCompilerTimeoutMs },
  );
}

// Periodic "Runtime stats" log line and, if enabled, the automatic CPU
// profile of a busy worker thread. 0 disables both.
const runtimeStatsIntervalMs = readNumberEnv(
  "RUNTIME_STATS_INTERVAL_MS",
  60_000,
);
const runtimeStatsOptions: RuntimeStatsOptions | undefined =
  runtimeStatsIntervalMs > 0
    ? {
        intervalMs: runtimeStatsIntervalMs,
        cpuProfile:
          process.env.WORKER_CPU_PROFILE_ENABLED === "true"
            ? {
                eluThreshold: readNumberEnv(
                  "WORKER_CPU_PROFILE_ELU_THRESHOLD",
                  0.9,
                ),
                sustainTicks: readNumberEnv(
                  "WORKER_CPU_PROFILE_SUSTAIN_TICKS",
                  3,
                ),
                durationMs: readNumberEnv(
                  "WORKER_CPU_PROFILE_DURATION_MS",
                  30_000,
                ),
                cooldownMs: readNumberEnv(
                  "WORKER_CPU_PROFILE_COOLDOWN_MS",
                  30 * 60 * 1000,
                ),
                topN: readNumberEnv("WORKER_CPU_PROFILE_TOP_N", 20),
              }
            : undefined,
      }
    : undefined;

// Solidity Compiler

const solcRepoPath =
  (config.get("solcRepo") as string) || path.join("/tmp", "solc-repo");
const solJsonRepoPath =
  (config.get("solJsonRepo") as string) || path.join("/tmp", "soljson-repo");

logger.info("Using local solidity compiler");
const selectedSolidityCompiler = new SolcLocal(
  solcRepoPath,
  solJsonRepoPath,
  compilerTimeoutMs,
);

export const solc = selectedSolidityCompiler;

logger.info("Using local vyper compiler");
const vyperRepoPath =
  (config.get("vyperRepo") as string) || path.join("/tmp", "vyper-repo");
export const vyper = new VyperLocal(vyperRepoPath, compilerTimeoutMs);

logger.info("Using local Fe compiler");
const feRepoPath =
  (config.get("feRepo") as string) || path.join("/tmp", "fe-repo");
export const fe = new FeLocal(feRepoPath, compilerTimeoutMs);

// To print regexes in the config object logs below
Object.defineProperty(RegExp.prototype, "toJSON", {
  value: RegExp.prototype.toString,
});

// Start Server — async because chain config is fetched at startup
(async () => {
  logger.info("Starting server with config", {
    config: JSON.stringify(config.util.toObject(), null, 2),
  });

  // Load chain config first so getEtherscanApiKeyForEachChain() sees the populated map
  const sourcifyChainsMap = await initializeSourcifyChains({
    remoteUrl: config.get<string>("chains.remoteUrl"),
  });

  const server = new Server(
    {
      port: config.get("server.port"),
      maxFileSize: config.get("server.maxFileSize"),
      corsAllowedOrigins: config.get("corsAllowedOrigins"),
      solc,
      vyper,
      fe,
      chains: sourcifyChainsMap,
      verifyDeprecated: config.get("verifyDeprecated"),
      replaceContract: config.get("replaceContract"),
      sourcifyPrivateToken: process.env.SOURCIFY_PRIVATE_TOKEN,
      logLevel,
      libSourcifyConfig,
      sourcifyVerifyUi: process.env.SOURCIFY_VERIFY_UI,
      sourcifyRepoUi: process.env.SOURCIFY_REPO_UI,
      runtimeStatsOptions,
    },
    {
      initCompilers: config.get("initCompilers") || false,
      sourcifyChainMap: sourcifyChainsMap,
      solcRepoPath,
      solJsonRepoPath,
      vyperRepoPath,
      feRepoPath,
      compilerTimeoutMs,
      workerTaskTimeoutMs,
      workerIdleTimeout: process.env.WORKER_IDLE_TIMEOUT
        ? parseInt(process.env.WORKER_IDLE_TIMEOUT)
        : undefined,
      concurrentVerificationsPerWorker: process.env
        .CONCURRENT_VERIFICATIONS_PER_WORKER
        ? parseInt(process.env.CONCURRENT_VERIFICATIONS_PER_WORKER)
        : undefined,
      debugDataS3Config:
        process.env.DEBUG_DATA_S3_BUCKET && process.env.DEBUG_DATA_S3_REGION
          ? {
              bucket: process.env.DEBUG_DATA_S3_BUCKET,
              region: process.env.DEBUG_DATA_S3_REGION,
              accessKeyId: process.env.DEBUG_DATA_S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.DEBUG_DATA_S3_SECRET_ACCESS_KEY,
              endpoint: process.env.DEBUG_DATA_S3_ENDPOINT,
            }
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
          ssl:
            process.env.SOURCIFY_POSTGRES_SSL === "true"
              ? {
                  rejectUnauthorized:
                    process.env.SOURCIFY_POSTGRES_SSL_REJECT_UNAUTHORIZED ===
                    "true",
                }
              : undefined,
        },
        schema: process.env.SOURCIFY_POSTGRES_SCHEMA as string,
        maxConnections: process.env.SOURCIFY_POSTGRES_MAX_CONNECTIONS
          ? parseInt(process.env.SOURCIFY_POSTGRES_MAX_CONNECTIONS)
          : undefined,
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
        maxConnections: process.env.ALLIANCE_DB_MAX_CONNECTIONS
          ? parseInt(process.env.ALLIANCE_DB_MAX_CONNECTIONS)
          : undefined,
      },
      etherscanVerifyApiServiceOptions: {
        EtherscanVerify: {
          defaultApiKey: process.env.ETHERSCAN_API_KEY as string,
          // Extract the etherscanApiKey env vars from the supported chains
          apiKeys: getEtherscanApiKeyForEachChain(sourcifyChainsMap),
        },
        BlockscoutVerify: {
          defaultApiKey: process.env.BLOCKSCOUT_API_KEY as string,
        },
        RoutescanVerify: {
          defaultApiKey: process.env.ROUTESCAN_API_KEY as string,
        },
      },
    },
  );

  // Generate the swagger.json and serve it with SwaggerUI at /api-docs
  await server.services.init();
  const swaggerDocument = await server.loadSwagger(
    yamljs.load(path.join(__dirname, "..", "openapi.yaml")), // load the openapi file with the $refs resolved
  );
  // Hide the private/internal endpoints from the public API docs (#2875).
  // They remain served and request-validated (server.ts loads openapi.yaml
  // independently for validation); we only strip them from the published spec.
  if (swaggerDocument?.paths) {
    for (const apiPath of Object.keys(swaggerDocument.paths)) {
      if (apiPath.startsWith("/private/")) {
        delete swaggerDocument.paths[apiPath];
      }
    }
  }
  if (Array.isArray(swaggerDocument?.tags)) {
    swaggerDocument.tags = swaggerDocument.tags.filter(
      (tag: { name?: string }) => tag?.name !== "Private",
    );
  }
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
})().catch((err) => {
  logger.error("Failed to start server", { error: err });
  process.exit(1);
});
