import { expect } from "chai";
import nock from "nock";
import {
  fetchChainRegistry,
  type RemoteChainRegistryResponse,
} from "../../src/chain-registry";

const TEST_REGISTRY_HOST = "https://registry.example.com";
const TEST_REGISTRY_PATH = "/chains";
const TEST_REGISTRY_URL = `${TEST_REGISTRY_HOST}${TEST_REGISTRY_PATH}`;

describe("chain-registry", () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    expect(nock.isDone(), "all nock interceptors should be consumed").to.equal(
      true,
    );
  });

  it("fetches and converts a chainlist-shaped response", async () => {
    const response: RemoteChainRegistryResponse = {
      "424242": {
        chainId: 424242,
        name: "Example Chain",
        rpc: ["https://rpc.example.com"],
      },
    };
    nock(TEST_REGISTRY_HOST).get(TEST_REGISTRY_PATH).reply(200, response);

    const result = await fetchChainRegistry({ url: TEST_REGISTRY_URL });

    expect(result.chainsJsonAdditions).to.have.length(1);
    expect(result.chainsJsonAdditions[0]).to.include({
      chainId: 424242,
      name: "Example Chain",
    });
    expect(result.chainsJsonAdditions[0].rpc).to.deep.equal([
      "https://rpc.example.com",
    ]);
    expect(result.extensionAdditions["424242"]).to.deep.include({
      sourcifyName: "Example Chain",
      supported: true,
    });
    expect(result.extensionAdditions["424242"].rpc).to.deep.equal([
      "https://rpc.example.com",
    ]);
  });

  it("skips entries marked hidden", async () => {
    const response: RemoteChainRegistryResponse = {
      "1": {
        chainId: 1,
        name: "Visible",
        rpc: ["https://rpc.visible.example"],
      },
      "2": {
        chainId: 2,
        name: "Hidden",
        rpc: ["https://rpc.hidden.example"],
        hidden: true,
      },
    };
    nock(TEST_REGISTRY_HOST).get(TEST_REGISTRY_PATH).reply(200, response);

    const result = await fetchChainRegistry({ url: TEST_REGISTRY_URL });

    const chainIds = result.chainsJsonAdditions.map((c) => c.chainId);
    expect(chainIds).to.deep.equal([1]);
    expect(result.extensionAdditions).to.have.keys("1");
  });

  it("drops non-http(s) RPC urls and skips entries with no usable RPC", async () => {
    const response: RemoteChainRegistryResponse = {
      "10": {
        chainId: 10,
        name: "Mixed RPCs",
        rpc: ["wss://ws.example.com", "https://rpc.example.com"],
      },
      "11": {
        chainId: 11,
        name: "Only ws",
        rpc: ["wss://ws.only.example.com"],
      },
    };
    nock(TEST_REGISTRY_HOST).get(TEST_REGISTRY_PATH).reply(200, response);

    const result = await fetchChainRegistry({ url: TEST_REGISTRY_URL });

    expect(result.chainsJsonAdditions.map((c) => c.chainId)).to.deep.equal([
      10,
    ]);
    expect(result.extensionAdditions["10"].rpc).to.deep.equal([
      "https://rpc.example.com",
    ]);
  });

  it("preserves a remote sourcifyExtension when provided", async () => {
    const response: RemoteChainRegistryResponse = {
      "777": {
        chainId: 777,
        name: "Custom",
        rpc: ["https://rpc.custom.example"],
        sourcifyExtension: {
          supported: true,
          etherscanApi: {
            supported: true,
            apiKeyEnvName: "CUSTOM_ETHERSCAN_API_KEY",
          },
          rpc: [
            {
              type: "BaseRPC",
              url: "https://custom.example/rpc",
            },
          ],
        },
      },
    };
    nock(TEST_REGISTRY_HOST).get(TEST_REGISTRY_PATH).reply(200, response);

    const result = await fetchChainRegistry({ url: TEST_REGISTRY_URL });

    expect(result.extensionAdditions["777"].sourcifyName).to.equal("Custom");
    expect(result.extensionAdditions["777"].etherscanApi).to.deep.equal({
      supported: true,
      apiKeyEnvName: "CUSTOM_ETHERSCAN_API_KEY",
    });
    expect(result.extensionAdditions["777"].rpc).to.deep.equal([
      { type: "BaseRPC", url: "https://custom.example/rpc" },
    ]);
  });

  it("sends an Authorization header when an authToken is provided", async () => {
    nock(TEST_REGISTRY_HOST, {
      reqheaders: { authorization: "Bearer test-token" },
    })
      .get(TEST_REGISTRY_PATH)
      .reply(200, {});

    const result = await fetchChainRegistry({
      url: TEST_REGISTRY_URL,
      authToken: "test-token",
    });

    expect(result.chainsJsonAdditions).to.deep.equal([]);
    expect(result.extensionAdditions).to.deep.equal({});
  });

  it("returns empty additions on a non-2xx response", async () => {
    nock(TEST_REGISTRY_HOST).get(TEST_REGISTRY_PATH).reply(503);

    const result = await fetchChainRegistry({ url: TEST_REGISTRY_URL });

    expect(result.chainsJsonAdditions).to.deep.equal([]);
    expect(result.extensionAdditions).to.deep.equal({});
  });

  it("returns empty additions on a malformed (non-object) payload", async () => {
    nock(TEST_REGISTRY_HOST)
      .get(TEST_REGISTRY_PATH)
      .reply(200, "not-an-object");

    const result = await fetchChainRegistry({ url: TEST_REGISTRY_URL });

    expect(result.chainsJsonAdditions).to.deep.equal([]);
    expect(result.extensionAdditions).to.deep.equal({});
  });

  it("returns empty additions on a network error", async () => {
    nock(TEST_REGISTRY_HOST)
      .get(TEST_REGISTRY_PATH)
      .replyWithError("connection refused");

    const result = await fetchChainRegistry({ url: TEST_REGISTRY_URL });

    expect(result.chainsJsonAdditions).to.deep.equal([]);
    expect(result.extensionAdditions).to.deep.equal({});
  });

  it("skips malformed entries but keeps valid ones", async () => {
    nock(TEST_REGISTRY_HOST)
      .get(TEST_REGISTRY_PATH)
      .reply(200, {
        bad: { name: "no chainId here" },
        good: {
          chainId: 99,
          name: "Good",
          rpc: ["https://rpc.good.example"],
        },
      });

    const result = await fetchChainRegistry({ url: TEST_REGISTRY_URL });

    expect(result.chainsJsonAdditions.map((c) => c.chainId)).to.deep.equal([
      99,
    ]);
  });
});
