import { z } from "zod";
import type { SourcifyClient } from "./SourcifyClient";
import { SourcifyApiError } from "./errors";
import {
  getContractAbi,
  getContractMetadata,
  getSourceFiles,
  checkVerificationStatus,
  listChainContracts,
  listSupportedChains,
} from "./tools";

/** A minimal CallToolResult shape (the SDK accepts this structurally). */
interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toErrorResult(err: unknown): ToolResult {
  if (err instanceof SourcifyApiError) {
    let hint = "";
    if (err.code === "unsupported_chain") {
      hint = " Use list_supported_chains to find valid chain IDs.";
    } else if (err.code === "not_found") {
      hint = " The contract is not verified on this chain.";
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Sourcify API error (${err.code}): ${err.message}.${hint}`,
        },
      ],
    };
  }
  throw err;
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return toErrorResult(err);
  }
}

const chainId = z
  .number()
  .int()
  .positive()
  .describe(
    "Numeric EVM chain ID (e.g. 1 = Ethereum mainnet, 11155111 = Sepolia). " +
      "Sourcify keys everything by numeric chain ID — use list_supported_chains " +
      "to resolve a chain name to its ID.",
  );

const address = z
  .string()
  .describe("Contract address, 0x-prefixed (EIP-55 checksummed or lowercase).");

/**
 * Builds an MCP server exposing read-only Sourcify contract-lookup tools.
 *
 * The SDK is imported dynamically because it is ESM-only; this keeps the
 * package CommonJS and consistent with the rest of the monorepo's tooling.
 */
export async function buildServer(client: SourcifyClient) {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const server = new McpServer({ name: "sourcify-mcp", version: "0.1.0" });

  server.registerTool(
    "get_contract_abi",
    {
      title: "Get contract ABI",
      description:
        "Fetch the ABI of a contract verified on Sourcify for a given chain and address.",
      inputSchema: { chainId, address },
    },
    async (args) =>
      run(() => getContractAbi(client, args.chainId, args.address)),
  );

  server.registerTool(
    "get_contract_metadata",
    {
      title: "Get contract metadata",
      description:
        "Fetch the Solidity metadata JSON of a verified contract (compiler settings, sources hashes, devdoc, etc.).",
      inputSchema: { chainId, address },
    },
    async (args) =>
      run(() => getContractMetadata(client, args.chainId, args.address)),
  );

  server.registerTool(
    "get_source_files",
    {
      title: "Get contract source files",
      description:
        "Fetch the verified source files (path -> content) and compilation info of a contract.",
      inputSchema: { chainId, address },
    },
    async (args) =>
      run(() => getSourceFiles(client, args.chainId, args.address)),
  );

  server.registerTool(
    "check_verification_status",
    {
      title: "Check verification status",
      description:
        "Check whether a contract is verified on Sourcify for a given chain. " +
        "Returns status 'exact', 'partial', or 'unverified'.",
      inputSchema: { chainId, address },
    },
    async (args) =>
      run(() => checkVerificationStatus(client, args.chainId, args.address)),
  );

  server.registerTool(
    "list_chain_contracts",
    {
      title: "List verified contracts on a chain",
      description:
        "List verified contracts on a chain, newest first. Cursor-paginated: " +
        "pass the returned nextCursor as afterMatchId to fetch the next page.",
      inputSchema: {
        chainId,
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max results to return (1-200, default 200)."),
        sort: z
          .enum(["asc", "desc"])
          .optional()
          .describe("Sort order by match ID (default desc = newest first)."),
        afterMatchId: z
          .string()
          .optional()
          .describe("Cursor: return contracts after this match ID."),
      },
    },
    async (args) =>
      run(() =>
        listChainContracts(client, args.chainId, {
          limit: args.limit,
          sort: args.sort,
          afterMatchId: args.afterMatchId,
        }),
      ),
  );

  server.registerTool(
    "list_supported_chains",
    {
      title: "List supported chains",
      description:
        "List the chains Sourcify supports, with numeric chainId, name, and supported flag. " +
        "Use this to resolve a chain name to its numeric ID before calling other tools.",
    },
    async () => run(() => listSupportedChains(client)),
  );

  return server;
}
