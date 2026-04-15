// Periodical tests of Import from Etherscan for each instance e.g. Arbiscan, Etherscan, Bscscan, etc.

import testContracts from "../helpers/etherscanInstanceContracts.json";
import { hookIntoVerificationWorkerRun } from "../helpers/helpers";
import chai, { request } from "chai";
import { ServerFixture } from "../helpers/ServerFixture";
import { ChainRepository } from "../../src/sourcify-chain-repository";
import type { VerificationStatus } from "@ethereum-sourcify/lib-sourcify";
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

  const testedChains: number[] = [];
  let chainId: keyof typeof testContracts;
  for (chainId in testContracts) {
    if (process.env.TEST_CHAIN && process.env.TEST_CHAIN !== chainId) continue;
    testedChains.push(parseInt(chainId));

    // describe() and it() titles are registered synchronously, before the
    // server fixture's before() hook has run, so serverFixture.sourcifyChainsMap
    // is not yet available here. We start with just the chainId and inject the
    // human-readable chain name at run time (see before/beforeEach below).
    describe(`#${chainId}`, function () {
      // `chainId` is a shared loop variable (`let` declared outside the loop),
      // so closures that run asynchronously (before/beforeEach/it callbacks)
      // would all see the last iteration's value. Capture the current value in
      // a `const` so every describe scope gets its own immutable copy.
      const id = chainId;

      // chainName is set in before() and read in beforeEach() — both close
      // over this variable so it stays in sync.
      let chainName: string;

      before(function () {
        const chain = serverFixture.sourcifyChainsMap[id];

        if (!chain?.supported) {
          throw new Error(
            `Unsupported chain (${id}) found in test configuration`,
          );
        }

        chainName = chain.name;

        // Rename the suite so reporters show the human-readable chain name.
        // Most Mocha reporters (spec, mochawesome, …) read suite.title after
        // all before() hooks have completed, so the renamed title appears in
        // the output correctly.
        this.test!.parent!.title = `#${id} ${chainName}`;
      });

      // it() titles are also fixed at registration time, so we patch
      // this.currentTest.title here — same reasoning as the suite rename above.
      beforeEach(function () {
        if (this.currentTest) {
          this.currentTest.title = this.currentTest.title.replace(
            `for chain ${id}`,
            `for chain ${chainName} (${id})`,
          );
        }
      });

      testContracts[id].forEach((contract) => {
        const address = contract.address;
        const expectedMatch = toMatchLevel(
          contract.expectedStatus as VerificationStatus,
        );
        const type = contract.type;

        // "for chain ${id}" is a placeholder that beforeEach() replaces
        // with the full "for chain ${chainName} (${id})" at run time.
        it(`Should import a ${type} contract from Etherscan for chain ${id} and verify the contract, finding a ${expectedMatch}`, async () => {
          const { resolveWorkers } = makeWorkersWait();

          const verifyRes = await request(serverFixture.server.app)
            .post(`/v2/verify/etherscan/${id}/${address}`)
            .send({});

          await assertJobVerification(
            serverFixture,
            verifyRes,
            resolveWorkers,
            id,
            getAddress(address),
            expectedMatch,
          );
        });
      });
    });
  }

  describe("Double check that all supported chains are tested", function () {
    it("should have tested all supported chains", function (done) {
      if (process.env.TEST_CHAIN) {
        return this.skip();
      }

      const supportedEtherscanChains = new ChainRepository(
        serverFixture.sourcifyChainsMap,
      ).sourcifyChainsArray.filter(
        (chain) => chain.etherscanApi?.supported && chain.supported,
      );

      const untestedChains = supportedEtherscanChains.filter(
        (chain) => !testedChains.includes(chain.chainId),
      );
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
