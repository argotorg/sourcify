import http from "http";
import { Pool } from "pg";
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
  pool: Pool;
  database: SignatureDatabase;
  httpServer?: http.Server;

  constructor(options: ServerOptions) {
    this.app = express();
    this.port = options.port;
    logger.info("4Byte Server port set", { port: this.port });
    this.pool = new Pool(options.databaseConfig);
    this.database = new SignatureDatabase(this.pool, {
      schema: options.databaseConfig.schema,
    });

    // Check database health during initialization
    this.checkDatabaseHealth();

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
    this.app.get("/signature-database/v1/stats", handlers.getSignaturesStats);

    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: "4bytes-api" });
    });

    const shutdown = async (signal: NodeJS.Signals) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      if (this.httpServer) {
        this.httpServer.close(async (error) => {
          if (error) {
            logger.error("Error while closing HTTP server", { error });
            process.exitCode = 1;
          }
          await this.pool.end();
          process.exit(0);
        });
      }
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  async checkDatabaseHealth(): Promise<void> {
    // Checking pool health before continuing
    try {
      logger.debug("Checking database pool health for 4bytes service");
      await this.pool.query("SELECT 1;");
      logger.info("Database connection healthy", {
        host: this.pool.options.host,
        port: this.pool.options.port,
        database: this.pool.options.database,
        user: this.pool.options.user,
      });
    } catch (error) {
      logger.error("Cannot connect to 4bytes database", {
        host: this.pool.options.host,
        port: this.pool.options.port,
        database: this.pool.options.database,
        user: this.pool.options.user,
        error,
      });
      throw new Error("Cannot connect to 4bytes database");
    }
  }

  async listen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.httpServer = this.app.listen(this.port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          logger.info(`4bytes API server running on port ${this.port}`);
          resolve();
        }
      });
    });
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down 4bytes server");
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close((error?: Error) => {
          if (error) {
            logger.error("Error closing 4bytes server", error);
          } else {
            logger.info("4bytes server closed");
          }
          resolve();
        });
      });
    }
    await this.pool.end();
    logger.info("4bytes database connection closed");
  }
}
