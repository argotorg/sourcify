import chai from "chai";
import {
  BINARY_SEARCH_TIMEOUT_MS,
  findContractCreationTxByBinarySearchWithTimeout,
  getCreatorTx,
} from "../../../src/server/services/utils/contract-creation-util";
import type { SourcifyChainMap } from "@ethereum-sourcify/lib-sourcify";
import sinon from "sinon";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { findContractCreationTxByBinarySearch } from "../../../src/server/services/utils/contract-creation-util";
import logger from "../../../src/common/logger";

// Tests hitting the live creation-tx APIs are in test/creation-tx-apis/.
describe("contract creation util", function () {
  let sourcifyChainsMap: SourcifyChainMap;

  // The dummy RPC satisfies SourcifyChain's "at least one RPC" requirement.
  before(async () => {
    const dummyRpcs = [{ rpc: "http://localhost/" }];
    sourcifyChainsMap = {
      "1": new SourcifyChain({
        name: "Ethereum Mainnet",
        chainId: 1,
        supported: true,
        rpcs: dummyRpcs,
        fetchContractCreationTxUsing: {
          etherscanApi: true,
          blockscoutApi: { url: "https://eth.blockscout.com/" },
          routescanApi: { type: "mainnet" },
        },
        etherscanApi: {
          supported: true,
          apiKeyEnvName: "ETHERSCAN_API_KEY_MAINNET",
        },
      }),
    };
  });

  describe("Etherscan API key handling for getCreatorTx", function () {
    const ADDRESS = "0x0000000000000000000000000000000000000001";
    const GLOBAL_KEY = "SECRET_GLOBAL_ETHERSCAN_KEY";
    let prevGlobalKey: string | undefined;
    let fetchStub: sinon.SinonStub;

    beforeEach(function () {
      prevGlobalKey = process.env.ETHERSCAN_API_KEY;
      process.env.ETHERSCAN_API_KEY = GLOBAL_KEY;
      fetchStub = sinon.stub(global, "fetch" as any).resolves({
        status: 200,
        json: async () => ({ result: [{ txHash: "0xabc" }] }),
      } as any);
    });

    afterEach(function () {
      fetchStub.restore();
      if (prevGlobalKey === undefined) delete process.env.ETHERSCAN_API_KEY;
      else process.env.ETHERSCAN_API_KEY = prevGlobalKey;
    });

    it("should NOT send the global ETHERSCAN_API_KEY to a custom Etherscan-compatible explorer (with url)", async function () {
      const chain = new SourcifyChain({
        name: "Custom Explorer Chain",
        chainId: 999999,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: { etherscanApi: true },
        etherscanApi: {
          supported: true,
          url: "https://block-explorer-api.testnet.battlechain.com",
        },
      });

      await getCreatorTx(chain, ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      const calledUrl = fetchStub.firstCall.args[0] as string;
      chai.expect(calledUrl).to.not.include(GLOBAL_KEY);
      chai.expect(calledUrl.endsWith("&apikey=")).to.equal(true);
    });

    it("should not log the API key when the API request fails", async function () {
      fetchStub.resolves({ status: 429, json: async () => ({}) } as any);
      const warnStub = sinon.stub(logger, "warn");
      const debugStub = sinon.stub(logger, "debug");
      const chain = new SourcifyChain({
        name: "Canonical Etherscan Chain",
        chainId: 1,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: { etherscanApi: true },
        etherscanApi: { supported: true },
      });

      try {
        await getCreatorTx(chain, ADDRESS);
      } finally {
        warnStub.restore();
        debugStub.restore();
      }

      chai.expect(fetchStub.calledOnce).to.equal(true);
      chai.expect(fetchStub.firstCall.args[0]).to.include(GLOBAL_KEY);
      const loggedArgs = JSON.stringify([
        ...warnStub.getCalls().map((call) => call.args),
        ...debugStub.getCalls().map((call) => call.args),
      ]);
      chai.expect(loggedArgs).to.not.include(GLOBAL_KEY);
      const warnCall = warnStub
        .getCalls()
        .map((call) => call.args as any[])
        .find((args) => args[0] === "Error while getting creation transaction");
      chai.expect(warnCall).to.not.equal(undefined);
      chai
        .expect(warnCall?.[1]?.error)
        .to.equal(
          `Contract creator tx could not be fetched from https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getcontractcreation&contractaddresses=${ADDRESS}&apikey= because of status code 429`,
        );
    });

    it("should send the global ETHERSCAN_API_KEY to a canonical Etherscan chain (no url)", async function () {
      const chain = new SourcifyChain({
        name: "Canonical Etherscan Chain",
        chainId: 1,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: { etherscanApi: true },
        etherscanApi: { supported: true },
      });

      await getCreatorTx(chain, ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      const calledUrl = fetchStub.firstCall.args[0] as string;
      chai.expect(calledUrl).to.include(GLOBAL_KEY);
    });
  });

  describe("Blockscout PRO API handling for getCreatorTx", function () {
    const ADDRESS = "0x0000000000000000000000000000000000000001";
    const PRO_API_KEY = "SECRET_BLOCKSCOUT_PRO_KEY";
    const INSTANCE_URL = "https://eth.blockscout.com/";
    let prevProApiKey: string | undefined;
    let fetchStub: sinon.SinonStub;

    const createChain = (proApi?: boolean) =>
      new SourcifyChain({
        name: "Blockscout Chain",
        chainId: 1,
        supported: true,
        rpcs: [{ rpc: "http://localhost/" }],
        fetchContractCreationTxUsing: {
          blockscoutApi: { url: INSTANCE_URL, proApi },
        },
      });

    beforeEach(function () {
      prevProApiKey = process.env.BLOCKSCOUT_PRO_API_KEY;
      process.env.BLOCKSCOUT_PRO_API_KEY = PRO_API_KEY;
      fetchStub = sinon.stub(global, "fetch" as any).resolves({
        status: 200,
        json: async () => ({ creation_transaction_hash: "0xabc" }),
      } as any);
    });

    afterEach(function () {
      fetchStub.restore();
      if (prevProApiKey === undefined)
        delete process.env.BLOCKSCOUT_PRO_API_KEY;
      else process.env.BLOCKSCOUT_PRO_API_KEY = prevProApiKey;
    });

    it("should use the PRO API gateway with the key when proApi is true", async function () {
      const creatorTx = await getCreatorTx(createChain(true), ADDRESS);

      chai.expect(creatorTx).to.equal("0xabc");
      chai.expect(fetchStub.calledOnce).to.equal(true);
      chai
        .expect(fetchStub.firstCall.args[0])
        .to.equal(
          `https://api.blockscout.com/1/api/v2/addresses/${ADDRESS}?apikey=${PRO_API_KEY}`,
        );
    });

    it("should use the instance url when proApi is false", async function () {
      await getCreatorTx(createChain(false), ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      const calledUrl = fetchStub.firstCall.args[0] as string;
      chai
        .expect(calledUrl)
        .to.equal(`${INSTANCE_URL}/api/v2/addresses/${ADDRESS}`);
      chai.expect(calledUrl).to.not.include(PRO_API_KEY);
    });

    it("should use the instance url when proApi is not set", async function () {
      await getCreatorTx(createChain(), ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      chai
        .expect(fetchStub.firstCall.args[0])
        .to.equal(`${INSTANCE_URL}/api/v2/addresses/${ADDRESS}`);
    });

    it("should use the instance url when BLOCKSCOUT_PRO_API_KEY is not set", async function () {
      delete process.env.BLOCKSCOUT_PRO_API_KEY;

      await getCreatorTx(createChain(true), ADDRESS);

      chai.expect(fetchStub.calledOnce).to.equal(true);
      chai
        .expect(fetchStub.firstCall.args[0])
        .to.equal(`${INSTANCE_URL}/api/v2/addresses/${ADDRESS}`);
    });
  });

  describe("findContractCreationTxByBinarySearch", function () {
    let mockSourcifyChain: SourcifyChain;
    const sandbox = sinon.createSandbox();

    beforeEach(() => {
      // Create a mock SourcifyChain instance
      mockSourcifyChain = {
        getBlockNumber: sinon.stub(),
        getBytecode: sinon.stub(),
        getBlock: sinon.stub(),
        getTxReceipt: sinon.stub(),
        chainId: 1,
      } as any;
    });

    afterEach(() => {
      sandbox.restore();
    });

    // Not a unit test — fetches from a live mainnet archive RPC. Skipped
    // because the test chain map is stubbed (mainnet uses http://localhost/),
    // so binary search has no real RPC to query. Re-enable locally when
    // debugging against a real RPC by replacing the mainnet stub's rpcs
    // entry with a working archive endpoint.
    it.skip("should find contract creation transaction using binary search for a live chain", async function () {
      // Don't run if it's an external PR. RPCs need API keys that can't be exposed to external PRs.
      if (process.env.CIRCLE_PR_REPONAME !== undefined) {
        console.log("Skipping binary search test for external PR");
        return;
      }

      // Create a copy of the mainnet chain
      const mainnetChain = Object.create(
        Object.getPrototypeOf(sourcifyChainsMap["1"]),
        Object.getOwnPropertyDescriptors(sourcifyChainsMap["1"]),
      );
      // remove all creation tx fetching methods
      mainnetChain.fetchContractCreationTxUsing = undefined;

      const sourcifyChain = new SourcifyChain(mainnetChain);

      const creatorTx = await findContractCreationTxByBinarySearch(
        sourcifyChain,
        "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Tether contract
      );

      chai
        .expect(creatorTx)
        .to.equal(
          "0x2f1c5c2b44f771e942a8506148e256f94f1a464babc938ae0690c6e34cd79190",
        );
    });

    it("should find contract creation transaction using binary search", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";
      const creationTxHash =
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

      const LATEST_BLOCK = 288031060;
      const CONTRACT_BLOCK = 4341321;

      // Mock chain responses
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).resolves(
        LATEST_BLOCK,
      );

      // Mock getBytecode to simulate contract deployment at block 500
      (mockSourcifyChain.getBytecode as sinon.SinonStub).callsFake(
        async (address, blockNumber) => {
          return blockNumber >= CONTRACT_BLOCK ? "0x1234" : "0x";
        },
      );

      // Mock block data
      const mockBlock = {
        prefetchedTransactions: [
          { hash: "0xother1", to: "0xsomeaddress" },
          { hash: "0xother2", to: "0xsomeaddress" },
          { hash: creationTxHash, to: null },
          { hash: "0xother3", to: "0xsomeaddress" },
        ],
        number: CONTRACT_BLOCK,
      };
      (mockSourcifyChain.getBlock as sinon.SinonStub).resolves(mockBlock);

      // Mock transaction receipt
      (mockSourcifyChain.getTxReceipt as sinon.SinonStub).resolves({
        contractAddress: contractAddress,
      });

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      // Verify the result
      chai.expect(result).to.equal(creationTxHash);

      // Verify binary search was performed correctly
      const bytecodeCalls = (
        mockSourcifyChain.getBytecode as sinon.SinonStub
      ).getCalls();
      chai.expect(bytecodeCalls.length).to.be.greaterThan(1); // Should make multiple calls during binary search

      // Verify the block at deployment was checked
      chai.expect(
        (mockSourcifyChain.getBlock as sinon.SinonStub).calledWith(
          CONTRACT_BLOCK,
          true,
        ),
      ).to.be.true;
    });

    it("should return null if contract creation transaction is not found", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // Mock chain responses
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).resolves(1000);
      (mockSourcifyChain.getBytecode as sinon.SinonStub).resolves("0x1234");

      // Mock block with no matching creation transaction
      const mockBlock = {
        prefetchedTransactions: [
          { hash: "0xtx1", to: "0xsomeaddress" },
          { hash: "0xtx2", to: "0xsomeaddress" },
        ],
        number: 500,
      };
      (mockSourcifyChain.getBlock as sinon.SinonStub).resolves(mockBlock);
      (mockSourcifyChain.getTxReceipt as sinon.SinonStub).resolves({
        contractAddress: "0xdifferentaddress",
      });

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      chai.expect(result).to.be.null;
    });

    it("should handle errors gracefully", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // Mock chain responses to throw error
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).rejects(
        new Error("Network error"),
      );

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      chai.expect(result).to.be.null;
    });

    it("should handle case where contract does not exist in any block", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // Mock chain responses
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).resolves(1000);
      // Contract never exists in any block
      (mockSourcifyChain.getBytecode as sinon.SinonStub).resolves("0x");

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      chai.expect(result).to.be.null;
    });

    it("should handle case where block has no transactions", async function () {
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // Mock chain responses
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).resolves(1000);
      (mockSourcifyChain.getBytecode as sinon.SinonStub).resolves("0x1234");

      // Mock empty block
      const mockBlock = {
        prefetchedTransactions: [],
        number: 500,
      };
      (mockSourcifyChain.getBlock as sinon.SinonStub).resolves(mockBlock);

      const result = await findContractCreationTxByBinarySearch(
        mockSourcifyChain,
        contractAddress,
      );

      chai.expect(result).to.be.null;
    });

    it("should timeout when binary search takes too long", async function () {
      const clock = sandbox.useFakeTimers();
      const contractAddress = "0x1234567890123456789012345678901234567890";

      // This will never resolve, forcing the timeout to trigger
      (mockSourcifyChain.getBlockNumber as sinon.SinonStub).returns(
        new Promise(() => {}),
      );

      const resultPromise = findContractCreationTxByBinarySearchWithTimeout(
        mockSourcifyChain,
        contractAddress,
      );

      await clock.tickAsync(BINARY_SEARCH_TIMEOUT_MS);

      const result = await resultPromise;
      chai.expect(result).to.be.null;
    });
  });
});
