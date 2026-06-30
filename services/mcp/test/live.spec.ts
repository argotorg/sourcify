import { expect } from "chai";
import { SourcifyClient } from "../src/SourcifyClient";
import { SourcifyApiError } from "../src/errors";
import {
  getContractAbi,
  getSourceFiles,
  checkVerificationStatus,
  listChainContracts,
  listSupportedChains,
} from "../src/tools";

/**
 * Live smoke tests against a real Sourcify server. Skipped unless
 * RUN_LIVE_TESTS is set, so the default suite stays hermetic and offline.
 *
 *   RUN_LIVE_TESTS=1 npm test
 *   RUN_LIVE_TESTS=1 SOURCIFY_SERVER_URL=https://staging.sourcify.dev/server npm test
 *
 * Fixtures are discovered from the live API (a real verified contract on
 * Ethereum mainnet) rather than hardcoded, so the tests don't rot.
 */
const SERVER_URL =
  process.env.SOURCIFY_SERVER_URL ?? "https://sourcify.dev/server";
const UNSUPPORTED_CHAIN_ID = 12345; // not a Sourcify chain -> unsupported_chain

describe("live Sourcify API", function () {
  this.timeout(30000);

  let client: SourcifyClient;
  let verifiedAddress: string;

  before(async function () {
    if (!process.env.RUN_LIVE_TESTS) this.skip();
    client = new SourcifyClient(SERVER_URL);
    // Discover a currently-verified mainnet contract to use as the fixture.
    const page = await client.listContracts(1, { limit: 1, sort: "desc" });
    const first = page.results?.[0];
    if (!first?.address)
      throw new Error("no verified contracts found on chain 1");
    verifiedAddress = first.address;
  });

  it("lists supported chains including Ethereum mainnet", async () => {
    const chains = await listSupportedChains(client);
    expect(chains.length).to.be.greaterThan(0);
    expect(chains.some((c) => c.chainId === 1)).to.equal(true);
  });

  it("reports a verified contract as exact or partial", async () => {
    const status = await checkVerificationStatus(client, 1, verifiedAddress);
    expect(status.status).to.be.oneOf(["exact", "partial"]);
  });

  it("returns a non-empty ABI for a verified contract", async () => {
    const { abi } = await getContractAbi(client, 1, verifiedAddress);
    expect(abi).to.be.an("array").with.length.greaterThan(0);
  });

  it("returns source files for a verified contract", async () => {
    const { sources } = await getSourceFiles(client, 1, verifiedAddress);
    expect(Object.keys(sources ?? {}).length).to.be.greaterThan(0);
  });

  it("lists verified contracts on a chain", async () => {
    const result = await listChainContracts(client, 1, { limit: 3 });
    expect(result.contracts.length).to.be.greaterThan(0);
  });

  it("reports an unverified address as 'unverified', not an error", async () => {
    const status = await checkVerificationStatus(
      client,
      1,
      "0x000000000000000000000000000000000000dEaD",
    );
    expect(status.status).to.equal("unverified");
  });

  it("throws unsupported_chain for a chain Sourcify does not support", async () => {
    try {
      await checkVerificationStatus(
        client,
        UNSUPPORTED_CHAIN_ID,
        verifiedAddress,
      );
      expect.fail("expected an unsupported_chain error");
    } catch (err) {
      expect(err).to.be.instanceOf(SourcifyApiError);
      expect((err as SourcifyApiError).code).to.equal("unsupported_chain");
    }
  });
});
