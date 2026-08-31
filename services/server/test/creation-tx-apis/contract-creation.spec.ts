import chai from "chai";
import { getCreatorTx } from "../../src/server/services/utils/contract-creation-util";
import { ChainRepository } from "../../src/sourcify-chain-repository";
import type {
  FetchContractCreationTxMethod,
  SourcifyChainMap,
} from "@ethereum-sourcify/lib-sourcify";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";

// Tests against live third-party APIs, run in the non-blocking test-creation-tx-apis CI job.
describe("creation-tx APIs (live)", function () {
  let sourcifyChainsMap: SourcifyChainMap;

  // The dummy RPC satisfies SourcifyChain's "at least one RPC" requirement; only
  // the fetchContractCreationTxUsing / etherscanApi config is exercised.
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
      "23294": new SourcifyChain({
        name: "Oasis Sapphire Mainnet",
        chainId: 23294,
        supported: true,
        rpcs: dummyRpcs,
        fetchContractCreationTxUsing: {
          nexusApi: {
            url: "https://nexus.oasis.io/",
            runtime: "sapphire",
          },
        },
      }),
      "43114": new SourcifyChain({
        name: "Avalanche C-Chain",
        chainId: 43114,
        supported: true,
        rpcs: dummyRpcs,
        fetchContractCreationTxUsing: {
          etherscanApi: true,
          routescanApi: { type: "mainnet" },
          avalancheApi: true,
        },
        etherscanApi: {
          supported: true,
          apiKeyEnvName: "ETHERSCAN_API_KEY_AVALANCHE",
        },
      }),
      "56": new SourcifyChain({
        name: "BNB Smart Chain Mainnet",
        chainId: 56,
        supported: true,
        rpcs: dummyRpcs,
        fetchContractCreationTxUsing: {
          nodeRealApi: {
            url: "https://bsc-mainnet.nodereal.io/v1/${API_KEY}",
          },
          etherscanApi: true,
        },
        etherscanApi: {
          supported: true,
          apiKeyEnvName: "ETHERSCAN_API_KEY_BSC",
        },
      }),
      "100009": new SourcifyChain({
        name: "VeChain Mainnet",
        chainId: 100009,
        supported: true,
        rpcs: dummyRpcs,
        fetchContractCreationTxUsing: {
          veChainApi: true,
        },
      }),
    };
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
    {
      type: "nodeRealApi",
      chainId: 56,
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      txHash:
        "0xcc0ddf5f791617ba9befce57995dbcb3a202946a1eefa3469742b01a0decdaf2",
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

      // Skip nodeRealApi test if NODEREAL_API_KEY is not set
      if (testCase.type === "nodeRealApi" && !process.env.NODEREAL_API_KEY) {
        console.log(`Skipping nodeRealApi test: NODEREAL_API_KEY not set`);
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
});
