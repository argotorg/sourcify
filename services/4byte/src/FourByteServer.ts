import type http from "http";
import logger from "./logger";
import { SignatureDatabase } from "./SignatureDatabase";
import { SignatureStats } from "./SignatureStats";
import type { SignatureStatsOptions } from "./SignatureStats";
import express from "express";
import cors from "cors";
import { createSignatureHandlers } from "./api/handlers";
import { validateHashQueries, validateSearchQuery } from "./api/validation";
import { createBrownoutMiddleware } from "./api/brownout";
import type { BrownoutConfig } from "./api/brownout";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number;
  schema?: string;
}

export interface ServerOptions {
  port: string | number;
  databaseConfig: DatabaseConfig;
  statsOptions?: SignatureStatsOptions;
  brownout?: BrownoutConfig;
}

export class FourByteServer {
  app: express.Application;
  port: string | number;
  database: SignatureDatabase;
  stats: SignatureStats;
  httpServer?: http.Server;

  constructor(options: ServerOptions) {
    this.app = express();
    this.port = options.port;
    logger.info("4Byte Server port set", { port: this.port });
    this.database = new SignatureDatabase(options.databaseConfig);
    this.stats = new SignatureStats(
      this.database,
      logger,
      options.statsOptions,
    );

    // Check database health during initialization
    this.database.checkDatabaseHealth().catch((error) => {
      logger.error("Error checking database health", { error });
      process.exit(1);
    });

    this.app.use(cors());
    // After cors, so that browsers can read the 503
    if (options.brownout) {
      this.app.use(createBrownoutMiddleware(options.brownout));
    }
    this.app.use(express.json());

    const handlers = createSignatureHandlers(this.database, this.stats, logger);

    this.app.get(
      "/signature-database/v1/lookup",
      validateHashQueries,
      handlers.lookupSignatures,
    );
    this.app.get(
      "/signature-database/v1/search",
      validateSearchQuery,
      handlers.searchSignatures,
    );
    this.app.post("/signature-database/v1/import", handlers.importSignatures);
    this.app.get("/signature-database/v1/stats", handlers.getSignaturesStats);
    this.app.get("/signature-database/v1/recent", handlers.getRecentSignatures);

    this.app.get("/health", async (_req, res) => {
      try {
        await this.database.checkDatabaseHealth();
      } catch (error) {
        logger.error("Error checking database health", { error });
        res.status(500).send("Error checking database health");
      }
      res.status(200).send("Alive and kicking!");
    });

    const handleShutdownSignal = async (signal?: NodeJS.Signals) => {
      await this.shutdown(signal);
      process.exit(0);
    };

    process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));
    process.on("SIGINT", () => handleShutdownSignal("SIGINT"));
  }

  async listen(): Promise<void> {
    await this.stats.start();
    return new Promise<void>((resolve, reject) => {
      this.httpServer = this.app.listen(this.port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          logger.info(`4byte API server running on port ${this.port}`);
          resolve();
        }
      });
    });
  }

  async shutdown(signal?: NodeJS.Signals): Promise<void> {
    logger.info(`Shutting down 4byte server ${signal ? `on ${signal}` : ""}`);
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close((error?: Error) => {
          if (error) {
            logger.error("Error closing 4byte server", error);
          } else {
            logger.info("4byte server closed");
          }
          resolve();
        });
      });
    }
    this.stats.stop();
    await this.database.close();
    logger.info("4byte database connection closed");
  }
}
