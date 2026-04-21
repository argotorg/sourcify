import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import fs from "fs";
import { initializeSourcifyChains } from "../../src/sourcify-chains";

use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(data: object): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => "Server Error",
  } as unknown as Response;
}

// Minimal chain extensions — just enough to pass through buildCustomRpcs
const REMOTE_URL = "https://example.com/chains.json";

const mockChainsConfig = {
  "1": {
    sourcifyName: "Ethereum Mainnet",
    supported: true,
    rpc: ["https://rpc.example.com"],
  },
  "5": {
    sourcifyName: "Goerli Testnet",
    supported: false,
    // no rpc — deprecated chain, supported:false skips the RPC check
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("initializeSourcifyChains", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  // -------------------------------------------------------------------------
  // Local file override
  // -------------------------------------------------------------------------
  describe("local sourcify-chains.json override", function () {
    it("loads chains from local file when it exists", async function () {
      sandbox.stub(fs, "existsSync").returns(true);
      sandbox
        .stub(fs, "readFileSync")
        .returns(JSON.stringify(mockChainsConfig) as any);

      const result = await initializeSourcifyChains({ remoteUrl: REMOTE_URL });

      expect(result).to.have.property("1");
      expect(result["1"].chainId).to.equal(1);
      expect(result["1"].supported).to.be.true;
    });

    it("includes unsupported chains loaded from local file", async function () {
      sandbox.stub(fs, "existsSync").returns(true);
      sandbox
        .stub(fs, "readFileSync")
        .returns(JSON.stringify(mockChainsConfig) as any);

      const result = await initializeSourcifyChains({ remoteUrl: REMOTE_URL });

      expect(result).to.have.property("5");
      expect(result["5"].supported).to.be.false;
    });

    it("skips remote fetch when local file exists", async function () {
      sandbox.stub(fs, "existsSync").returns(true);
      sandbox
        .stub(fs, "readFileSync")
        .returns(JSON.stringify(mockChainsConfig) as any);
      const fetchStub = sandbox.stub(globalThis, "fetch");

      await initializeSourcifyChains({ remoteUrl: REMOTE_URL });

      expect(fetchStub.called).to.be.false;
    });
  });

  // -------------------------------------------------------------------------
  // Remote fetch
  // -------------------------------------------------------------------------
  describe("remote fetch", function () {
    beforeEach(function () {
      // No local file present for any of these tests
      sandbox.stub(fs, "existsSync").returns(false);
    });

    it("fetches and populates chains from remote URL on first attempt", async function () {
      sandbox
        .stub(globalThis, "fetch")
        .resolves(makeOkResponse(mockChainsConfig));

      const result = await initializeSourcifyChains({ remoteUrl: REMOTE_URL });

      expect(result).to.have.property("1");
      expect(result["1"].chainId).to.equal(1);
    });

    it("throws when remoteUrl is not configured", async function () {
      await expect(
        initializeSourcifyChains({ remoteUrl: "" }),
      ).to.be.rejectedWith("chains.remoteUrl is not configured");
    });

    it("throws on HTTP error response", async function () {
      const clock = sandbox.useFakeTimers();
      sandbox.stub(globalThis, "fetch").resolves(makeErrorResponse(404));

      // Attach the rejection assertion before ticking so chai-as-promised
      // handles the rejection before mocha sees it as unhandled
      const assertion = expect(
        initializeSourcifyChains({ remoteUrl: REMOTE_URL }),
      ).to.be.rejectedWith("HTTP 404");
      await clock.tickAsync(7000);
      await assertion;
    });

    it("retries on fetch failure and succeeds on second attempt", async function () {
      const clock = sandbox.useFakeTimers();

      const fetchStub = sandbox.stub(globalThis, "fetch");
      fetchStub.onFirstCall().rejects(new Error("Network error"));
      fetchStub.onSecondCall().resolves(makeOkResponse(mockChainsConfig));

      const promise = initializeSourcifyChains({ remoteUrl: REMOTE_URL });
      // Advance past the 3 s retry delay so the second attempt can run
      await clock.tickAsync(3001);
      const result = await promise;

      expect(fetchStub.callCount).to.equal(2);
      expect(result).to.have.property("1");
    });

    it("throws after all retry attempts are exhausted", async function () {
      const clock = sandbox.useFakeTimers();

      sandbox.stub(globalThis, "fetch").rejects(new Error("Network error"));

      // Attach the rejection assertion before ticking so chai-as-promised
      // handles the rejection before mocha sees it as unhandled
      const assertion = expect(
        initializeSourcifyChains({ remoteUrl: REMOTE_URL }),
      ).to.be.rejectedWith("Failed to fetch chains config after 3 attempts");
      // 3 attempts with a 3 s delay between each → advance 7 s to cover all
      await clock.tickAsync(7000);
      await assertion;
    });
  });

  // -------------------------------------------------------------------------
  // Chain building
  // -------------------------------------------------------------------------
  describe("chain building", function () {
    beforeEach(function () {
      sandbox.stub(fs, "existsSync").returns(false);
    });

    it("returns a fresh map on each call (independent results)", async function () {
      const firstConfig = {
        "1": {
          sourcifyName: "First",
          supported: true,
          rpc: ["https://rpc1.example.com"],
        },
      };
      const secondConfig = {
        "137": {
          sourcifyName: "Polygon",
          supported: true,
          rpc: ["https://rpc2.example.com"],
        },
      };

      const fetchStub = sandbox.stub(globalThis, "fetch");
      fetchStub.onFirstCall().resolves(makeOkResponse(firstConfig));
      fetchStub.onSecondCall().resolves(makeOkResponse(secondConfig));

      const first = await initializeSourcifyChains({ remoteUrl: REMOTE_URL });
      const second = await initializeSourcifyChains({ remoteUrl: REMOTE_URL });

      expect(first).to.not.equal(second); // distinct object references
      expect(first).to.have.property("1");
      expect(first).to.not.have.property("137");
      expect(second).to.have.property("137");
      expect(second).to.not.have.property("1");
    });

    it("skips supported chains that have no usable RPCs", async function () {
      const chainsWithNoRpc = {
        "99998": {
          sourcifyName: "No RPC Chain",
          supported: true,
          rpc: [], // empty — will produce zero SourcifyRpc entries
        },
      };
      sandbox
        .stub(globalThis, "fetch")
        .resolves(makeOkResponse(chainsWithNoRpc));

      const result = await initializeSourcifyChains({ remoteUrl: REMOTE_URL });

      expect(result).to.not.have.property("99998");
    });

    it("includes deprecated chains that have no RPCs (supported: false)", async function () {
      const deprecatedChains = {
        "5": {
          sourcifyName: "Goerli",
          supported: false,
          // no rpc field — deprecated, no RPC check applied
        },
      };
      sandbox
        .stub(globalThis, "fetch")
        .resolves(makeOkResponse(deprecatedChains));

      const result = await initializeSourcifyChains({ remoteUrl: REMOTE_URL });

      expect(result).to.have.property("5");
      expect(result["5"].supported).to.be.false;
    });

    it("uses string keys for all chain entries", async function () {
      sandbox
        .stub(globalThis, "fetch")
        .resolves(makeOkResponse(mockChainsConfig));

      const result = await initializeSourcifyChains({ remoteUrl: REMOTE_URL });

      for (const key of Object.keys(result)) {
        expect(key).to.be.a("string");
      }
    });
  });
});
