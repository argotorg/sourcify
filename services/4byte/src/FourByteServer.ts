import type http from "http";
import logger from "./logger";
import { SignatureDatabase } from "./SignatureDatabase";
import express from "express";
import cors from "cors";
import { createSignatureHandlers } from "./api/handlers";
import { validateHashQueries, validateSearchQuery } from "./api/validation";

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
}

export class FourByteServer {
  app: express.Application;
  port: string | number;
  database: SignatureDatabase;
  httpServer?: http.Server;

  constructor(options: ServerOptions) {
    this.app = express();
    this.port = options.port;
    logger.info("4Byte Server port set", { port: this.port });
    this.database = new SignatureDatabase(options.databaseConfig);

    // Check database health during initialization
    this.database.checkDatabaseHealth().catch((error) => {
      logger.error("Error checking database health", { error });
      process.exit(1);
    });

    this.app.use(cors());
    this.app.use(express.json());

    const handlers = createSignatureHandlers(this.database, logger);

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
    await this.database.close();
    logger.info("4byte database connection closed");
  }
}
