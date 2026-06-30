# sourcify-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes
Sourcify's verified-contract data — ABI, metadata, source files, and verification
status — to AI coding agents (Claude Code, Cursor, etc.).

It is a thin, **read-only** wrapper over Sourcify's public [v2 HTTP API](https://docs.sourcify.dev/docs/api/).
Like [sourcify-monitor](../monitor), it is a standalone auxiliary service that consumes
the public API only — it does not depend on the database or on `lib-sourcify` internals,
and it contains no verification logic.

## Tools

| Tool                        | Description                                       | Backing endpoint                                       |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `get_contract_abi`          | ABI of a verified contract                        | `GET /v2/contract/{chainId}/{address}?fields=abi`      |
| `get_contract_metadata`     | Solidity metadata JSON                            | `…?fields=metadata`                                    |
| `get_source_files`          | Verified source files + compilation info          | `…?fields=sources,compilation`                         |
| `check_verification_status` | `exact` / `partial` / `unverified` status         | `…?fields=match,creationMatch,runtimeMatch,verifiedAt` |
| `list_chain_contracts`      | Verified contracts on a chain (cursor-paginated)  | `GET /v2/contracts/{chainId}`                          |
| `list_supported_chains`     | Supported chains (`chainId`, `name`, `supported`) | `GET /chains`                                          |

### Chain selection

Sourcify keys everything by **numeric chain ID** — there are no name aliases. Agents
should call `list_supported_chains` to resolve a chain name (e.g. "Polygon") to its
numeric ID before calling the other tools. `check_verification_status` returns
`unverified` for a contract that isn't in Sourcify, but surfaces an error for an
unsupported/unknown chain so the two cases stay distinct.

## Configuration

| Env var               | Default                       | Description                                                     |
| --------------------- | ----------------------------- | --------------------------------------------------------------- |
| `SOURCIFY_SERVER_URL` | `https://sourcify.dev/server` | Base URL of the Sourcify server to query (see `.env.template`). |

## Build & run

```bash
# from the repo root
npm ci
npx lerna run build --scope sourcify-mcp

# from this directory
npm start            # runs dist/index.js, speaking MCP over stdio
```

### Use with an MCP client

The server communicates over **stdio**. Point your client at the built entrypoint.

Claude Code:

```bash
claude mcp add sourcify -- node /abs/path/to/sourcify/services/mcp/dist/index.js
```

Or a client config (e.g. Cursor / `.mcp.json`):

```json
{
  "mcpServers": {
    "sourcify": {
      "command": "node",
      "args": ["/abs/path/to/sourcify/services/mcp/dist/index.js"],
      "env": { "SOURCIFY_SERVER_URL": "https://sourcify.dev/server" }
    }
  }
}
```

Inspect the tools interactively with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Testing

```bash
npm test          # unit + protocol tests (hermetic; HTTP mocked with nock)
npm run check     # eslint + prettier
```

Tests have three layers:

- **Unit** (`SourcifyClient`, tools, normalize) — HTTP mocked with `nock`; covers
  field selection and error normalization (400 `unsupported_chain` vs 404 → `unverified`).
- **Protocol** (`server.spec.ts`) — drives a real MCP `Client` against the server over
  an in-memory transport, asserting tool listing and end-to-end calls.
- **Live** (optional) — none run by default; smoke-test against staging manually with the
  Inspector or a real client when validating the public API shape.
