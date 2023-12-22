// Periodical tests of Import from Etherscan for each instance e.g. Arbiscan, Etherscan, Bscscan, etc.

const Server = require("../../dist/server/server").Server;
const rimraf = require("rimraf");
const testContracts = require("../helpers/etherscanInstanceContracts.json");
const {
  sourcifyChainsMap,
  sourcifyChainsArray,
} = require("../../dist/sourcify-chains");
const util = require("util");
const { verifyAndAssertEtherscan } = require("../helpers/helpers");
const chai = require("chai");

const CUSTOM_PORT = 5679;

describe("Test each Etherscan instance", function () {
  this.timeout(30000);
  const server = new Server(CUSTOM_PORT);

  before(async () => {
    const promisified = util.promisify(server.app.listen);
    await promisified(server.port);
    console.log(`Server listening on port ${server.port}!`);
  });

  beforeEach(() => {
    rimraf.sync(server.repository);
  });

  after(() => {
    rimraf.sync(server.repository);
  });

  let testedChains = [];
  for (const chainId in testContracts) {
    if (process.env.TEST_CHAIN && process.env.TEST_CHAIN !== chainId) continue;
    testedChains.push(parseInt(chainId));
    describe(`#${chainId} ${sourcifyChainsMap[chainId].name}`, () => {
      testContracts[chainId].forEach((contract) => {
        verifyAndAssertEtherscan(
          server.app,
          chainId,
          contract.address,
          contract.expectedStatus,
          contract.type,
          contract?.creatorTxHash
        );
      });
    });
  }
  describe("Double check that all supported chains are tested", () => {
    const supportedEtherscanChains = sourcifyChainsArray.filter(
      (chain) => chain.etherscanApi && chain.supported
    );

    it("should have tested all supported chains", function (done) {
      const untestedChains = supportedEtherscanChains.filter(
        (chain) => !testedChains.includes(chain.chainId)
      );
      if (process.env.TEST_CHAIN) {
        return this.skip();
      }
      chai.assert(
        untestedChains.length == 0,
        `There are untested supported chains!: ${untestedChains
          .map((chain) => `${chain.name} (${chain.chainId})`)
          .join(", ")}`
      );

      done();
    });
  });
});
