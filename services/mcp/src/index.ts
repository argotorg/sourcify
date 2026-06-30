#!/usr/bin/env node
import * as path from "path";
import * as dotenv from "dotenv";
import { resolveServerUrl } from "./config";
import { SourcifyClient } from "./SourcifyClient";
import { buildServer } from "./server";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

async function main(): Promise<void> {
  const serverUrl = resolveServerUrl(process.env);
  const client = new SourcifyClient(serverUrl);
  const server = await buildServer(client);

  const { StdioServerTransport } =
    await import("@modelcontextprotocol/sdk/server/stdio.js");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Log to stderr: stdout carries the JSON-RPC stream and must not be polluted.
  console.error("Fatal error starting sourcify-mcp:", err);
  process.exit(1);
});
