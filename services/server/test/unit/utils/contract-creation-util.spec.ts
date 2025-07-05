import chai from "chai";
import { getCreatorTx } from "../../../src/server/services/utils/contract-creation-util";
import { sourcifyChainsMap } from "../../../src/sourcify-chains";
import { ChainRepository } from "../../../src/sourcify-chain-repository";
import { FetchContractCreationTxMethod } from "@ethereum-sourcify/lib-sourcify";
import sinon from "sinon";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { findContractCreationTxByBinarySearch } from "../../../src/server/services/utils/contract-creation-util";

describe("contract creation util", function () {
  it("should run getCreatorTx with chainId 40", async function () {
    const sourcifyChainsArray = new ChainRepository(sourcifyChainsMap)
      .sourcifyChainsArray;
    const sourcifyChain = sourcifyChainsArray.find(
      (sourcifyChain) => sourcifyChain.chainId === 40,
    );
    if (!sourcifyChain) {
      chai.assert.fail("No chain for chainId 40 configured");
    }
    const creatorTx = await getCreatorTx(
      sourcifyChain,
      "0x4c09368a4bccD1675F276D640A0405Efa9CD4944",
    );
    chai
      .expect(creatorTx)
      .equals(
        "0xb7efb33c736b1e8ea97e356467f99d99221343f077ce31a3e3ac1d2e0636df1d",
      );
  });

  // Commenting out as fails way too often
  // it("should run getCreatorTx with chainId 51", async function () {
  //   const sourcifyChain = sourcifyChainsArray.find(
  //     (sourcifyChain) => sourcifyChain.chainId === 51
  //   );
  //   if (!sourcifyChain) {
  //     chai.assert.fail("No chain for chainId 51 configured");
  //   }
  //   const creatorTx = await getCreatorTx(
  //     sourcifyChain,
  //     "0x8C3FA94eb5b07c9AF7dBFcC53ea3D2BF7FdF3617"
  //   );
  //   chai
  //     .expect(creatorTx)
  //     .equals(
  //       "0xb1af0ec1283551480ae6e6ce374eb4fa7d1803109b06657302623fc65c987420"
  //     );
  // });

  it("should run getCreatorTx with chainId 83", async function () {
    const sourcifyChainsArray = new ChainRepository(sourcifyChainsMap)
      .sourcifyChainsArray;
    const sourcifyChain = sourcifyChainsArray.find(
      (sourcifyChain) => sourcifyChain.chainId === 83,
    );
    if (!sourcifyChain) {
      chai.assert.fail("No chain for chainId 83 configured");
    }
    const creatorTx = await getCreatorTx(
      sourcifyChain,
      "0x89e772941d94Ef4BDA1e4f68E79B4bc5F6096389",
    );
    chai
      .expect(creatorTx)
      .equals(
        "0x8cc7b0fb66eaf7b32bac7b7938aedfcec6d49f9fe607b8008a5541e72d264069",
      );
  });

  it("should run getCreatorTx with chainId 335", async function () {
    const sourcifyChainsArray = new ChainRepository(sourcifyChainsMap)
      .sourcifyChainsArray;
    const sourcifyChain = sourcifyChainsArray.find(
      (sourcifyChain) => sourcifyChain.chainId === 335,
    );
    if (!sourcifyChain) {
      chai.assert.fail("No chain for chainId 335 configured");
    }
    const creatorTx = await getCreatorTx(
      sourcifyChain,
      "0x40D843D06dAC98b2586fD1DFC5532145208C909F",
    );
    chai
      .expect(creatorTx)
      .equals(
        "0xd125cc92f61d0898d55a918283f8b855bde15bc5f391b621e0c4eee25c9997ee",
      );
  });

  it("should run getCreatorTx with regex for new Blockscout", async function () {
    const sourcifyChainsArray = new ChainRepository(sourcifyChainsMap)
      .sourcifyChainsArray;
    const sourcifyChain = sourcifyChainsArray.find(
      (sourcifyChain) => sourcifyChain.chainId === 100,
    );
    if (!sourcifyChain) {
      chai.assert.fail("No chain for chainId 100 configured");
    }
    const creatorTx = await getCreatorTx(
      sourcifyChain,
      "0x3CE1a25376223695284edc4C2b323C3007010C94",
    );
    chai
      .expect(creatorTx)
      .equals(
        "0x11da550e6716be8b4bd9203cb384e89b8f8941dc460bd99a4928ce2825e05456",
      );
  });

  it("should run getCreatorTx with regex for old Blockscout", async function () {
    const sourcifyChainsArray = new ChainRepository(sourcifyChainsMap)
      .sourcifyChainsArray;
    const sourcifyChain = sourcifyChainsArray.find(
      (sourcifyChain) => sourcifyChain.chainId === 57,
    );
    if (!sourcifyChain) {
      chai.assert.fail("No chain for chainId 57 configured");
    }
    const creatorTx = await getCreatorTx(
      sourcifyChain,
      "0x43e9f7ca4AEAcd67A7AC4a275cee7BC8AF601bE4",
    );
    chai
      .expect(creatorTx)
      .equals(
        "0x89a8c2ac5f93b91a8a551bf4c676755e1ad5272e0a7193b894aa8ba14c43c5ea",
      );
  });

  it("should run getCreatorTx with nexusApi for Nexus", async function () {
    const sourcifyChainsArray = new ChainRepository(sourcifyChainsMap)
      .sourcifyChainsArray;
    const sourcifyChain = sourcifyChainsArray.find(
      (sourcifyChain) => sourcifyChain.chainId === 23294,
    );
    if (!sourcifyChain) {
      chai.assert.fail("No chain for chainId 23294 configured");
    }
    const creatorTx = await getCreatorTx(
      sourcifyChain,
      "0x8Bc2B030b299964eEfb5e1e0b36991352E56D2D3",
    );
    chai
      .expect(creatorTx)
      .equals(
        "0xce775b521cc6e1341020560441d77cd634b0972fc34bf96f79e9fab81caa8ab7",
      );
  });

  // Test each fetchContractCreationTxUsing method
  // We can use the Mainnet to test all below as all support Mainnet
  const testCases: {
    type: FetchContractCreationTxMethod;
    chainId: number;
    address: string;
    txHash: string;
  }[] = [
    {
      type: "blockscoutApi",
      chainId: 1,
      address: "0x00000000219ab540356cBB839Cbe05303d7705Fa",
      txHash:
        "0xe75fb554e433e03763a1560646ee22dcb74e5274b34c5ad644e7c0f619a7e1d0",
    },
    {
      type: "routescanApi",
      chainId: 1,
      address: "0x00000000219ab540356cBB839Cbe05303d7705Fa",
      txHash:
        "0xe75fb554e433e03763a1560646ee22dcb74e5274b34c5ad644e7c0f619a7e1d0",
    },
    {
      type: "etherscanApi",
      chainId: 1,
      address: "0x00000000219ab540356cBB839Cbe05303d7705Fa",
      txHash:
        "0xe75fb554e433e03763a1560646ee22dcb74e5274b34c5ad644e7c0f619a7e1d0",
    },
    {
      type: "avalancheApi",
      chainId: 43114,
      address: "0xf3D455D5e756EfceC05C49E5721b539265466bbB",
      txHash:
        "0x7790ee646f9cf4d4ec0d2e9dbb4943e606d18bab0e36fe71075b0a8246c6be4e",
    },
    {
      type: "veChainApi",
      chainId: 100009,
      address: "0xae4c53b120cba91a44832f875107cbc8fbee185c",
      txHash:
        "0x0ace736bc4ad5a25e2493d71fbc3315e422068ecefb3715d86ea85ab0ba26716",
    },
  ];
  for (const testCase of testCases) {
    it(`should run getCreatorTx with ${testCase.type}`, async function () {
      const sourcifyChainsArray = new ChainRepository(sourcifyChainsMap)
        .sourcifyChainsArray;
      const sourcifyChain = sourcifyChainsArray.find(
        (sourcifyChain) => sourcifyChain.chainId === testCase.chainId,
      );
      if (!sourcifyChain) {
        chai.assert.fail(`No chain for chainId ${testCase.chainId} configured`);
      }

      // Don't run if it's an external PR. Etherscan tests need API keys that can't be exposed to external PRs.
      if (
        (testCase.type === "etherscanApi" || testCase.type === "veChainApi") &&
        process.env.CIRCLE_PR_REPONAME !== undefined
      ) {
        console.log(`Skipping ${testCase.type} test for external PR`);
        return;
      }

      // Remove all other fetchContractCreationTxUsing methods except the one we're testing
      const testChain = Object.create(
        Object.getPrototypeOf(sourcifyChain),
        Object.getOwnPropertyDescriptors(sourcifyChain),
      );
      if (testChain.fetchContractCreationTxUsing) {
        testChain.fetchContractCreationTxUsing = {
          [testCase.type]:
            testChain.fetchContractCreationTxUsing[testCase.type],
        };
      }
      // Block the getBlockNumber call to block the binary search
      testChain.getBlockNumber = async () => {
        throw new Error("Blocked getBlockNumber");
      };

      const creatorTx = await getCreatorTx(testChain, testCase.address);
      chai
        .expect(creatorTx)
        .equals(testCase.txHash, `Failed for ${testCase.type}`);
    });
  }

  describe("findContractCreationTxByBinarySearch", function () {
    let mockSourcifyChain: SourcifyChain;

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
        Object.getPrototypeOf(sourcifyChainsMap[1]),
        Object.getOwnPropertyDescriptors(sourcifyChainsMap[1]),
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
  });
});
