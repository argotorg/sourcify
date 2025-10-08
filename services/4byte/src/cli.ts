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
    host: process.env.FOURBYTES_POSTGRES_HOST || "localhost",
    port: process.env.FOURBYTES_POSTGRES_PORT
      ? parseInt(process.env.FOURBYTES_POSTGRES_PORT)
      : 5432,
    database: process.env.FOURBYTES_POSTGRES_DB || "sourcify",
    user: process.env.FOURBYTES_POSTGRES_USER || "postgres",
    password: process.env.FOURBYTES_POSTGRES_PASSWORD || "",
    max: process.env.FOURBYTES_POSTGRES_MAX_CONNECTIONS
      ? parseInt(process.env.FOURBYTES_POSTGRES_MAX_CONNECTIONS)
      : 20,
    schema: process.env.FOURBYTES_POSTGRES_SCHEMA,
  },
});

// Enable Swagger UI for CLI usage
const apiSpecPath = path.join(__dirname, "openapi.yaml");
const openApiSpec = yaml.load(apiSpecPath);
server.app.get("/api-docs/swagger.json", (req, res) => {
  res.json(openApiSpec);
});
server.app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle:
      "Sourcify Ethereum Function, Event, and Error Signatures API",
    customfavIcon: "https://sourcify.dev/favicon.ico",
  }),
);

server
  .listen()
  .then(() => {
    logger.info("4byte API server started successfully");
  })
  .catch((error) => {
    logger.error("Failed to start 4byte API server", { error });
    server.shutdown();
  });
