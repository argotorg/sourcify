import { expect } from "chai";
import nock from "nock";
import { SourcifyClient } from "../src/SourcifyClient";
import { SourcifyApiError } from "../src/errors";
import {
  getContractAbi,
  getContractMetadata,
  getSourceFiles,
  checkVerificationStatus,
  listChainContracts,
  listSupportedChains,
} from "../src/tools";

const ORIGIN = "http://localhost:5555";
const CHAIN_ID = 1;
const ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

function client() {
  return new SourcifyClient(ORIGIN);
}

describe("MCP tool functions", function () {
  afterEach(() => nock.cleanAll());

  it("getContractAbi returns the ABI", async () => {
    nock(ORIGIN)
      .get(`/v2/contract/${CHAIN_ID}/${ADDRESS}`)
      .query({ fields: "abi" })
      .reply(200, { abi: [{ type: "fallback" }] });

    const result = await getContractAbi(client(), CHAIN_ID, ADDRESS);

    expect(result).to.deep.equal({
      chainId: CHAIN_ID,
      address: ADDRESS,
      abi: [{ type: "fallback" }],
    });
  });

  it("getContractMetadata returns the metadata", async () => {
    nock(ORIGIN)
      .get(`/v2/contract/${CHAIN_ID}/${ADDRESS}`)
      .query({ fields: "metadata" })
      .reply(200, { metadata: { language: "Solidity" } });

    const result = await getContractMetadata(client(), CHAIN_ID, ADDRESS);

    expect(result.metadata).to.deep.equal({ language: "Solidity" });
  });

  it("getSourceFiles returns sources and compilation info", async () => {
    nock(ORIGIN)
      .get(`/v2/contract/${CHAIN_ID}/${ADDRESS}`)
      .query({ fields: "sources,compilation" })
      .reply(200, {
        compilation: { name: "WETH9", compilerVersion: "0.4.19" },
        sources: { "WETH9.sol": { content: "contract WETH9 {}" } },
      });

    const result = await getSourceFiles(client(), CHAIN_ID, ADDRESS);

    expect(result.compilation).to.deep.equal({
      name: "WETH9",
      compilerVersion: "0.4.19",
    });
    expect(result.sources).to.have.property("WETH9.sol");
  });

  it("checkVerificationStatus normalizes an exact match (no fields selector)", async () => {
    // The match fields are part of the always-returned minimal record and are
    // NOT valid `fields` selectors, so no query string must be sent.
    nock(ORIGIN).get(`/v2/contract/${CHAIN_ID}/${ADDRESS}`).reply(200, {
      match: "exact_match",
      creationMatch: "exact_match",
      runtimeMatch: "match",
      verifiedAt: "2024-01-01T00:00:00Z",
    });

    const result = await checkVerificationStatus(client(), CHAIN_ID, ADDRESS);

    expect(result).to.deep.equal({
      chainId: CHAIN_ID,
      address: ADDRESS,
      status: "exact",
      creationMatch: "exact_match",
      runtimeMatch: "match",
      verifiedAt: "2024-01-01T00:00:00Z",
    });
  });

  it("checkVerificationStatus returns 'unverified' on a 404 instead of throwing", async () => {
    nock(ORIGIN)
      .get(`/v2/contract/${CHAIN_ID}/${ADDRESS}`)
      .query(true)
      .reply(404, { customCode: "not_found", message: "Contract not found" });

    const result = await checkVerificationStatus(client(), CHAIN_ID, ADDRESS);

    expect(result.status).to.equal("unverified");
  });

  it("checkVerificationStatus still throws for an unsupported chain", async () => {
    nock(ORIGIN).get(`/v2/contract/9999/${ADDRESS}`).query(true).reply(400, {
      customCode: "unsupported_chain",
      message: "Chain 9999 not found",
    });

    try {
      await checkVerificationStatus(client(), 9999, ADDRESS);
      expect.fail("expected checkVerificationStatus to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(SourcifyApiError);
      expect((err as SourcifyApiError).code).to.equal("unsupported_chain");
    }
  });

  it("listChainContracts returns the contracts and a nextCursor", async () => {
    nock(ORIGIN)
      .get(`/v2/contracts/${CHAIN_ID}`)
      .query({ limit: "2", sort: "desc" })
      .reply(200, {
        results: [
          { address: "0xaaa", matchId: "100" },
          { address: "0xbbb", matchId: "99" },
        ],
      });

    const result = await listChainContracts(client(), CHAIN_ID, {
      limit: 2,
      sort: "desc",
    });

    expect(result.chainId).to.equal(CHAIN_ID);
    expect(result.contracts).to.have.length(2);
    expect(result.nextCursor).to.equal("99");
  });

  it("listChainContracts returns a null nextCursor when there are no results", async () => {
    nock(ORIGIN)
      .get(`/v2/contracts/${CHAIN_ID}`)
      .query(true)
      .reply(200, { results: [] });

    const result = await listChainContracts(client(), CHAIN_ID, {});

    expect(result.contracts).to.have.length(0);
    expect(result.nextCursor).to.equal(null);
  });

  it("listSupportedChains maps to chainId/name/supported", async () => {
    nock(ORIGIN)
      .get(`/chains`)
      .reply(200, [
        { chainId: 1, name: "Ethereum Mainnet", supported: true, rpc: ["x"] },
        { chainId: 11155111, name: "Sepolia", supported: true, rpc: ["y"] },
      ]);

    const result = await listSupportedChains(client());

    expect(result).to.deep.equal([
      { chainId: 1, name: "Ethereum Mainnet", supported: true },
      { chainId: 11155111, name: "Sepolia", supported: true },
    ]);
  });
});
