import { expect } from "chai";
import nock from "nock";
import { buildServer } from "../src/server";
import { SourcifyClient } from "../src/SourcifyClient";

const ORIGIN = "http://localhost:5555";
const ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

async function connect() {
  // The SDK is ESM-only at the type level; load it dynamically so this
  // CommonJS test module compiles cleanly under `module: node16`.
  const { Client } = await import("@modelcontextprotocol/sdk/client");
  const { InMemoryTransport } =
    await import("@modelcontextprotocol/sdk/inMemory.js");
  const server = await buildServer(new SourcifyClient(ORIGIN));
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content[0];
  if (first?.type !== "text" || first.text === undefined) {
    throw new Error("expected text content");
  }
  return first.text;
}

describe("MCP server (protocol)", function () {
  afterEach(() => nock.cleanAll());

  it("exposes the six contract-lookup tools", async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).to.include.members([
      "get_contract_abi",
      "get_contract_metadata",
      "get_source_files",
      "check_verification_status",
      "list_chain_contracts",
      "list_supported_chains",
    ]);

    await client.close();
  });

  it("calls get_contract_abi end-to-end through the protocol", async () => {
    nock(ORIGIN)
      .get(`/v2/contract/1/${ADDRESS}`)
      .query({ fields: "abi" })
      .reply(200, { abi: [{ type: "fallback" }] });

    const { client } = await connect();

    const result = (await client.callTool({
      name: "get_contract_abi",
      arguments: { chainId: 1, address: ADDRESS },
    })) as { content: Array<{ type: string; text?: string }> };

    const parsed = JSON.parse(textOf(result));
    expect(parsed.abi).to.deep.equal([{ type: "fallback" }]);

    await client.close();
  });

  it("returns an error result for an unsupported chain", async () => {
    nock(ORIGIN).get(`/v2/contract/9999/${ADDRESS}`).query(true).reply(400, {
      customCode: "unsupported_chain",
      message: "Chain 9999 not found",
    });

    const { client } = await connect();

    const result = (await client.callTool({
      name: "check_verification_status",
      arguments: { chainId: 9999, address: ADDRESS },
    })) as {
      isError?: boolean;
      content: Array<{ type: string; text?: string }>;
    };

    expect(result.isError).to.equal(true);
    expect(textOf(result)).to.match(/chain/i);

    await client.close();
  });
});
