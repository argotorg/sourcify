// CLI module to be run when running the server from the CLI
import { config } from "dotenv";
config();

import path from "path";
import swaggerUi from "swagger-ui-express";
import yaml from "yamljs";
import logger from "./logger";
import { FourByteServer } from "./FourByteServer";

const port = process.env.PORT || 4444;

const server = new FourByteServer({
  port,
});

// Enable Swagger UI for CLI usage
const apiSpecPath = path.join(__dirname, "openapi.yaml");
const openApiSpec = yaml.load(apiSpecPath);
server.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

server.listen().then(() => {
  logger.info("4bytes API server started successfully");
});
