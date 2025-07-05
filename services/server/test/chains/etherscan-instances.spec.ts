// Periodical tests of Import from Etherscan for each instance e.g. Arbiscan, Etherscan, Bscscan, etc.

import testContracts from "../helpers/etherscanInstanceContracts.json";
import { sourcifyChainsMap } from "../../src/sourcify-chains";
import { hookIntoVerificationWorkerRun } from "../helpers/helpers";
import chai, { request } from "chai";
import { ServerFixture } from "../helpers/ServerFixture";
import { ChainRepository } from "../../src/sourcify-chain-repository";
import { VerificationStatus } from "@ethereum-sourcify/lib-sourcify";
import { assertJobVerification } from "../helpers/assertions";
import { toMatchLevel } from "../../src/server/services/utils/util";
import sinon from "sinon";
import { getAddress } from "ethers";

const CUSTOM_PORT = 5679;

describe("Test each Etherscan instance", function () {
  const serverFixture = new ServerFixture({
    port: CUSTOM_PORT,
  });
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  afterEach(async () => {
    sandbox.restore();
  });

  const sourcifyChainsArray = new ChainRepository(sourcifyChainsMap)
    .sourcifyChainsArray;

  const testedChains: number[] = [];
  let chainId: keyof typeof testContracts;
  for (chainId in testContracts) {
    if (!sourcifyChainsMap[chainId].supported) {
      throw new Error(
        `Unsupported chain (${chainId}) found in test configuration`,
      );
    }
    if (process.env.TEST_CHAIN && process.env.TEST_CHAIN !== chainId) continue;
    testedChains.push(parseInt(chainId));

    describe(`#${chainId} ${sourcifyChainsMap[chainId].name}`, () => {
      testContracts[chainId].forEach((contract) => {
        const address = contract.address;
        const expectedMatch = toMatchLevel(
          contract.expectedStatus as VerificationStatus,
        );
        const type = contract.type;
        const chain = chainId;

        it(`Should import a ${type} contract from Etherscan for chain ${sourcifyChainsMap[chain].name} (${chain}) and verify the contract, finding a ${expectedMatch}`, async () => {
          const { resolveWorkers } = makeWorkersWait();

          const verifyRes = await request(serverFixture.server.app)
            .post(`/v2/verify/etherscan/${chain}/${address}`)
            .send({});

          await assertJobVerification(
            serverFixture,
            verifyRes,
            resolveWorkers,
            chain,
            getAddress(address),
            expectedMatch,
          );
        });
      });
    });
  }

  describe("Double check that all supported chains are tested", () => {
    const supportedEtherscanChains = sourcifyChainsArray.filter(
      (chain) => chain.etherscanApi?.supported && chain.supported,
    );

    it("should have tested all supported chains", function (done) {
      const untestedChains = supportedEtherscanChains.filter(
        (chain) => !testedChains.includes(chain.chainId),
      );
      if (process.env.TEST_CHAIN) {
        return this.skip();
      }
      chai.assert(
        untestedChains.length == 0,
        `There are untested supported chains!: ${untestedChains
          .map((chain) => `${chain.name} (${chain.chainId})`)
          .join(", ")}`,
      );

      done();
    });
  });
});
