import chai from "chai";
import sinon from "sinon";
import { findContractCreationTxByBinarySearch } from "../../../services/utils/contract-creation-util";
import { loadConfig } from "../../../config/Loader";
import { Chain } from "../../../services/chain/Chain";
import { ChainMap } from "../../../server";

describe("findContractCreationTxByBinarySearch", function () {
  const config = loadConfig();
  const sourcifyChainsMap: ChainMap = {};
  for (const chainObj of Object.values(config.chains)) {
    sourcifyChainsMap[chainObj.chainId.toString()] = new Chain(chainObj);
  }

  let mockSourcifyChain: Chain;

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

  // Not a unit test fetches from live chain, but it's useful for debugging
  it("should find contract creation transaction using binary search for a live chain", async function () {
    // Don't run if it's an external PR. RPCs need API keys that can't be exposed to external PRs.
    if (process.env.CIRCLE_PR_REPONAME !== undefined) {
      console.log("Skipping binary search test for external PR");
      return;
    }

    // Create a copy of the mainnet chain
    const mainnetChain = Object.create(
      Object.getPrototypeOf(sourcifyChainsMap[1029]),
      Object.getOwnPropertyDescriptors(sourcifyChainsMap[1029]),
    );
    // remove all creation tx fetching methods
    mainnetChain.fetchContractCreationTxUsing = undefined;

    const sourcifyChain = new Chain(mainnetChain);

    const creatorTx = await findContractCreationTxByBinarySearch(
      sourcifyChain,
      "0x8b8689C7F3014A4D86e4d1D0daAf74A47f5E0f27", // USDT
    );

    chai
      .expect(creatorTx)
      .to.equal(
        "0x42d4059aa135b60981faff017cdc413a6bcdd8473002411bdc292de21680040b",
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
});
