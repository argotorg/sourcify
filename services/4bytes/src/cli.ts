// CLI module to be run when running the server from the CLI
import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env") });

import swaggerUi from "swagger-ui-express";
import yaml from "yamljs";
import logger from "./logger";
import { FourByteServer } from "./FourByteServer";

const port = process.env.PORT || 4444;

const server = new FourByteServer({
  port,
  databaseConfig: {
    host: process.env.POSTGRES_HOST || "localhost",
    port: process.env.POSTGRES_PORT
      ? parseInt(process.env.POSTGRES_PORT)
      : 5432,
    database: process.env.POSTGRES_DB || "sourcify",
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "",
    max: process.env.POSTGRES_MAX_CONNECTIONS
      ? parseInt(process.env.POSTGRES_MAX_CONNECTIONS)
      : 20,
    schema: process.env.POSTGRES_SCHEMA,
  },
});

// Enable Swagger UI for CLI usage
const apiSpecPath = path.join(__dirname, "openapi.yaml");
const openApiSpec = yaml.load(apiSpecPath);
server.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

server
  .listen()
  .then(() => {
    logger.info("4bytes API server started successfully");
  })
  .catch((error) => {
    logger.error("Failed to start 4bytes API server", { error });
    process.exit(1);
  });
