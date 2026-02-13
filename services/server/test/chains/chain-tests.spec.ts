import { ServerFixture } from "../helpers/ServerFixture";
import chai from "chai";
import chaiHttp from "chai-http";
import addContext from "mochawesome/addContext";
import testEtherscanContracts from "../helpers/etherscanInstanceContracts.json";
import config from "config";
import sourcifyChainsDefault from "../../src/sourcify-chains-default.json";
import _storageAddresses from "./sources/storage-contract-chain-addresses.json";
const storageAddresses: Record<string, string> = _storageAddresses; // add types
import createXInput from "./sources/createX.input.json";
import multicallInput from "./sources/multicall.input.json";
import storageInput from "./sources/storage.input.json";
// @ts-ignore
config["session"].storeType = "memory";

const TEST_TIME = process.env.TEST_TIME || "60000"; // 1 minute
const CUSTOM_PORT = 5556;
const POLL_INTERVAL = 3000; // 3 seconds between job polls

const CREATEX_ADDRESS = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed";
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const CREATEX_DEPLOYMENTS_URL =
  "https://raw.githubusercontent.com/pcaversaccio/createx/refs/heads/main/deployments/deployments.json";
const MULTICALL3_DEPLOYMENTS_URL =
  "https://raw.githubusercontent.com/mds1/multicall3/refs/heads/main/deployments.json";

interface ContractInput {
  address: string;
  stdJsonInput: object;
  compilerVersion: string;
  contractIdentifier: string;
}

const CREATEX_CONTRACT: Omit<ContractInput, "address"> = {
  stdJsonInput: createXInput,
  compilerVersion: "0.8.23+commit.f704f362",
  contractIdentifier: "src/CreateX.sol:CreateX",
};

const MULTICALL3_CONTRACT: Omit<ContractInput, "address"> = {
  stdJsonInput: multicallInput,
  compilerVersion: "0.8.12+commit.f00d7308",
  contractIdentifier: "Multicall3.sol:Multicall3",
};

const STORAGE_CONTRACT: Omit<ContractInput, "address"> = {
  stdJsonInput: storageInput,
  compilerVersion: "0.8.7+commit.e28d00a7",
  contractIdentifier: "contracts/1_Storage.sol:Storage",
};

// Extract the chainId from new chain support pull request, if exists
let newAddedChainIds: string[] = [];
if (process.env.NEW_CHAIN_ID) {
  newAddedChainIds = process.env.NEW_CHAIN_ID.split(",");
}
console.log("newAddedChainIds");
console.log(newAddedChainIds);

let anyTestsPass = false; // Fail when zero tests passing

// Build the list of chains to test synchronously from config (needed for Mocha test registration)
const chainsToTest = Object.entries(sourcifyChainsDefault)
  .filter(([id, chainConfig]) => {
    if (!chainConfig.supported) return false;
    if (id === "1337" || id === "31337") return false;
    if (newAddedChainIds.length && !newAddedChainIds.includes(id)) return false;
    return true;
  })
  .map(([id, chainConfig]) => ({
    chainId: id,
    name: chainConfig.sourcifyName,
  }));

chai.use(chaiHttp);

describe("Test Supported Chains", function () {
  console.log(
    `Set up tests timeout with ${Math.floor(parseInt(TEST_TIME) / 1000)} secs`,
  );
  this.timeout(TEST_TIME);
  const serverFixture = new ServerFixture({
    port: CUSTOM_PORT,
  });

  const testedChains = new Set<string>();
  let createXChainIds: Set<string>;
  let multicall3ChainIds: Set<string>;

  before(async function () {
    // Fetch createX and multicall3 deployments in parallel
    const [createXRes, multicall3Res] = await Promise.all([
      fetch(CREATEX_DEPLOYMENTS_URL),
      fetch(MULTICALL3_DEPLOYMENTS_URL),
    ]);
    const createXDeployments: { chainId: string }[] = await createXRes.json();
    const multicall3Deployments: { chainId: string }[] =
      await multicall3Res.json();

    createXChainIds = new Set(
      createXDeployments.map((d) => d.chainId.toString()),
    );
    multicall3ChainIds = new Set(
      multicall3Deployments.map((d) => d.chainId.toString()),
    );
  });

  after(() => {
    if (!anyTestsPass && newAddedChainIds.length) {
      throw new Error(
        "There needs to be at least one passing test. Did you forget to add a test for your new chain with the id(s) " +
          newAddedChainIds.join(",") +
          "?",
      );
    }
  });

  // Dynamically register a test for each supported chain
  for (const chain of chainsToTest) {
    if (newAddedChainIds.length && !newAddedChainIds.includes(chain.chainId))
      continue;

    it(`should verify a contract on ${chain.name} (${chain.chainId})`, async function () {
      addContext(this, {
        title: "Test identifier",
        value: { chainId: chain.chainId, testType: "normal" },
      });

      if (createXChainIds.has(chain.chainId)) {
        await verifyContract(
          { address: CREATEX_ADDRESS, ...CREATEX_CONTRACT },
          chain.chainId,
        );
      } else if (multicall3ChainIds.has(chain.chainId)) {
        await verifyContract(
          { address: MULTICALL3_ADDRESS, ...MULTICALL3_CONTRACT },
          chain.chainId,
        );
      } else if (storageAddresses[chain.chainId] !== undefined) {
        await verifyContract(
          { address: storageAddresses[chain.chainId], ...STORAGE_CONTRACT },
          chain.chainId,
        );
      } else {
        throw new Error(
          `No test contract found for chain ${chain.name} (${chain.chainId})`,
        );
      }
    });
    testedChains.add(chain.chainId);
  }

  it("should have included Etherscan contracts for all testedChains having etherscanAPI", function (done) {
    const missingEtherscanTests: { chainId: string; name: string }[] = [];
    chainsToTest
      .filter((chain) => testedChains.has(chain.chainId))
      .forEach((chain) => {
        const chainConfig = sourcifyChainsDefault[
          chain.chainId as keyof typeof sourcifyChainsDefault
        ] as Record<string, any>;
        if (
          chainConfig.etherscanApi?.supported &&
          !Object.prototype.hasOwnProperty.call(
            testEtherscanContracts,
            chain.chainId,
          )
        ) {
          missingEtherscanTests.push(chain);
        }
      });

    chai.assert(
      missingEtherscanTests.length == 0,
      `There are missing Etherscan tests for chains: ${missingEtherscanTests
        .map((chain) => `${chain.name} (${chain.chainId})`)
        .join(",\n")}`,
    );

    done();
  });

  // Finally check if all the "supported: true" chains have been tested
  it("should have tested all supported chains", function (done) {
    if (newAddedChainIds.length) {
      // Don't test all chains if it is a pull request for adding new chain support
      return this.skip();
    }

    const untestedChains = chainsToTest.filter(
      (chain) => !testedChains.has(chain.chainId),
    );
    chai.assert(
      untestedChains.length == 0,
      `There are untested chains!: ${untestedChains
        .map((chain) => `${chain.name} (${chain.chainId})`)
        .join(",\n")}`,
    );

    done();
  });

  //////////////////////
  // Helper functions //
  //////////////////////

  async function verifyContract(contract: ContractInput, chainId: string) {
    // Submit verification via v2 API
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/${chainId}/${contract.address}`)
      .send({
        stdJsonInput: contract.stdJsonInput,
        compilerVersion: contract.compilerVersion,
        contractIdentifier: contract.contractIdentifier,
      });

    chai
      .expect(verifyRes.status)
      .to.equal(
        202,
        "Response body: " + JSON.stringify(verifyRes.body),
      );
    chai.expect(verifyRes.body).to.have.property("verificationId");

    // Poll until the verification job completes (with timeout)
    const verificationId = verifyRes.body.verificationId;
    const maxPolls = Math.floor(parseInt(TEST_TIME) / POLL_INTERVAL);
    let jobRes;
    let polls = 0;
    do {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      jobRes = await chai
        .request(serverFixture.server.app)
        .get(`/v2/verify/${verificationId}`);
      polls++;
    } while (!jobRes.body.isJobCompleted && polls < maxPolls);

    chai.expect(jobRes.body.isJobCompleted).to.be.true;

    // Assert verification succeeded
    chai
      .expect(jobRes.body.contract.match)
      .to.not.be.null;

    anyTestsPass = true;
  }
});
