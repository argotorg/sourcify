import { expect } from "chai";
import nock from "nock";
import { SourcifyClient } from "../src/SourcifyClient";
import { SourcifyApiError } from "../src/errors";

const ORIGIN = "http://localhost:5555";
const CHAIN_ID = 1;
const ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("SourcifyClient.getContract", function () {
  afterEach(() => {
    nock.cleanAll();
  });

  it("requests the v2 contract endpoint with the given fields and returns the parsed body", async () => {
    const scope = nock(ORIGIN)
      .get(`/v2/contract/${CHAIN_ID}/${ADDRESS}`)
      .query({ fields: "abi" })
      .reply(200, {
        chainId: String(CHAIN_ID),
        address: ADDRESS,
        abi: [{ type: "fallback" }],
      });

    const client = new SourcifyClient(ORIGIN);
    const result = await client.getContract(CHAIN_ID, ADDRESS, {
      fields: ["abi"],
    });

    expect(scope.isDone()).to.equal(true);
    expect(result.abi).to.deep.equal([{ type: "fallback" }]);
  });

  it("trims a trailing slash from the base URL", async () => {
    const scope = nock(ORIGIN)
      .get(`/v2/contract/${CHAIN_ID}/${ADDRESS}`)
      .query(true)
      .reply(200, { chainId: String(CHAIN_ID), address: ADDRESS });

    const client = new SourcifyClient(`${ORIGIN}/`);
    await client.getContract(CHAIN_ID, ADDRESS, { fields: ["abi"] });

    expect(scope.isDone()).to.equal(true);
  });

  it("throws SourcifyApiError 'unsupported_chain' on a 400 unsupported_chain response", async () => {
    nock(ORIGIN).get(`/v2/contract/9999/${ADDRESS}`).query(true).reply(400, {
      customCode: "unsupported_chain",
      message: "Chain 9999 not found",
    });

    const client = new SourcifyClient(ORIGIN);

    try {
      await client.getContract(9999, ADDRESS, { fields: ["abi"] });
      expect.fail("expected getContract to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(SourcifyApiError);
      expect((err as SourcifyApiError).code).to.equal("unsupported_chain");
      expect((err as SourcifyApiError).status).to.equal(400);
    }
  });

  it("throws SourcifyApiError 'not_found' on a 404 response", async () => {
    nock(ORIGIN)
      .get(`/v2/contract/${CHAIN_ID}/${ADDRESS}`)
      .query(true)
      .reply(404, { customCode: "not_found", message: "Contract not found" });

    const client = new SourcifyClient(ORIGIN);

    try {
      await client.getContract(CHAIN_ID, ADDRESS, { fields: ["abi"] });
      expect.fail("expected getContract to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(SourcifyApiError);
      expect((err as SourcifyApiError).code).to.equal("not_found");
      expect((err as SourcifyApiError).status).to.equal(404);
    }
  });

  it("rejects when both fields and omit are provided", async () => {
    const client = new SourcifyClient(ORIGIN);

    try {
      await client.getContract(CHAIN_ID, ADDRESS, {
        fields: ["abi"],
        omit: ["sources"],
      });
      expect.fail("expected getContract to throw");
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
      expect((err as Error).message).to.match(/mutually exclusive/i);
    }
  });
});
