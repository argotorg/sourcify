import chai from "chai";
import chaiHttp from "chai-http";
import { StatusCodes } from "http-status-codes";
import {
  assertVerification,
  assertValidationError,
} from "../../../helpers/assertions";
import {
  unusedAddress,
  invalidAddress,
  unsupportedChain,
  verifyAndAssertEtherscanViaApiV1,
} from "../../../helpers/helpers";
import type { Response } from "superagent";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import nock from "nock";
import {
  mockEtherscanApi,
  deployEtherscanFixtures,
  SINGLE_CONTRACT,
  MULTIPLE_CONTRACT,
  STANDARD_JSON_CONTRACT,
  VYPER_SINGLE_CONTRACT,
  VYPER_STANDARD_JSON_CONTRACT,
  MALFORMED_VERSION_CONTRACT,
  UNVERIFIED_CONTRACT_RESPONSE,
  INVALID_API_KEY_RESPONSE,
  RATE_LIMIT_REACHED_RESPONSE,
} from "../../../helpers/etherscanTestCases";
import type { EtherscanDeployments } from "../../../helpers/etherscanTestCases";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";

chai.use(chaiHttp);

const CUSTOM_PORT = 5678;

describe("Import From Etherscan and Verify", function () {
  // Don't run if it's an external PR. Etherscan tests need API keys that can't be exposed to external PRs.
  if (process.env.CIRCLE_PR_REPONAME !== undefined) {
    return;
  }

  const chainFixture = new LocalChainFixture();
  // Mainnet stub points at the real hardhat node that LocalChainFixture
  // spawns. We deliberately do NOT set fetchContractCreationTxUsing.etherscanApi
  // here: the verification worker runs in a Piscina thread, and nock's
  // http-module patches don't propagate across thread boundaries — so an
  // Etherscan-based getcontractcreation call from the worker would have to
  // hit the real internet. Leaving etherscanApi out of the fetchers makes
  // getCreatorTx fall back to RPC binary search, which stays inside the
  // hardhat node and is fast on a chain with only a handful of blocks.
  const mainnetStub = new SourcifyChain({
    name: "Ethereum Mainnet (test stub)",
    chainId: 1,
    supported: true,
    rpcs: [
      {
        rpc: "http://localhost:8545",
        urlWithoutApiKey: "http://localhost:8545",
        maskedUrl: "http://localhost:8545",
      },
    ],
    etherscanApi: { supported: true, apiKeyEnvName: "ETHERSCAN_API_KEY" },
  });
  const serverFixture = new ServerFixture({
    port: CUSTOM_PORT,
    chains: { "1": mainnetStub },
  });

  const testChainId = "1";
  let deployments: EtherscanDeployments;

  before(async () => {
    deployments = await deployEtherscanFixtures(chainFixture.localSigner);
  });

  this.afterEach(() => {
    nock.cleanAll();
  });

  const assertEtherscanError = (
    err: Error | null,
    res: Response,
    errorMessage: string,
    status?: number,
  ) => {
    try {
      chai.expect(res.status).to.equal(status || StatusCodes.NOT_FOUND);
      chai.expect(res.body?.error).to.equal(errorMessage);
    } catch (e) {
      console.log("Error: ", e);
      console.log("Response: ", res.body);
      throw e;
    }
  };

  describe("Non-Session API", () => {
    it("should fail for missing address", (done) => {
      chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("chain", testChainId)
        .end((err, res) => {
          assertValidationError(
            err,
            res,
            "address",
            "request/body must have required property 'address'",
          );
          done();
        });
    });

    it("should fail for missing chain", (done) => {
      chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("address", unusedAddress)
        .end((err, res) => {
          assertValidationError(
            err,
            res,
            "chain",
            "request/body must have required property 'chain'",
          );
          done();
        });
    });

    it("should fail for invalid address", (done) => {
      chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("address", invalidAddress)
        .field("chain", testChainId)
        .end((err, res) => {
          assertValidationError(
            err,
            res,
            "address",
            `Invalid address: ${invalidAddress}`,
          );
          done();
        });
    });

    it("should fail for unsupported chain", (done) => {
      chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("address", unusedAddress)
        .field("chain", unsupportedChain)
        .end((err, res) => {
          assertValidationError(
            err,
            res,
            "chain",
            `Chain ${unsupportedChain} not supported for verification!`,
          );
          done();
        });
    });

    it("should fail fetching a non verified contract from etherscan", (done) => {
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        unusedAddress,
        UNVERIFIED_CONTRACT_RESPONSE,
      );
      chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("address", unusedAddress)
        .field("chain", testChainId)
        .end((err, res) => {
          assertEtherscanError(
            err,
            res,
            "This contract is not verified on Etherscan.",
          );
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        });
    });

    it(`Non-Session: Should import a single contract from Etherscan for ${testChainId} and verify the contract, finding a ${SINGLE_CONTRACT.expectedStatus} match`, (done) => {
      const address = deployments.SINGLE_CONTRACT!.address;
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        address,
        SINGLE_CONTRACT.etherscanResponse,
      );

      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        address,
        SINGLE_CONTRACT.expectedStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Non-Session: Should import a multiple contract from Etherscan for ${testChainId} and verify the contract, finding a ${MULTIPLE_CONTRACT.expectedStatus} match`, (done) => {
      const address = deployments.MULTIPLE_CONTRACT!.address;
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        address,
        MULTIPLE_CONTRACT.etherscanResponse,
      );

      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        address,
        MULTIPLE_CONTRACT.expectedStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Non-Session: Should import a standard-json contract from Etherscan for ${testChainId} and verify the contract, finding a ${STANDARD_JSON_CONTRACT.expectedStatus} match`, (done) => {
      const address = deployments.STANDARD_JSON_CONTRACT!.address;
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        address,
        STANDARD_JSON_CONTRACT.etherscanResponse,
      );

      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        address,
        STANDARD_JSON_CONTRACT.expectedStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Non-Session: Should import a Vyper single contract from Etherscan for ${testChainId} and verify the contract, finding a ${VYPER_SINGLE_CONTRACT.expectedStatus} match`, (done) => {
      const address = deployments.VYPER_SINGLE_CONTRACT!.address;
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        address,
        VYPER_SINGLE_CONTRACT.etherscanResponse,
      );

      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        address,
        VYPER_SINGLE_CONTRACT.expectedStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
        false,
      );
    });

    it(`Non-Session: Should import a Vyper standard-json contract from Etherscan for ${testChainId} and verify the contract, finding a ${VYPER_STANDARD_JSON_CONTRACT.expectedStatus} match`, (done) => {
      const address = deployments.VYPER_STANDARD_JSON_CONTRACT!.address;
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        address,
        VYPER_STANDARD_JSON_CONTRACT.etherscanResponse,
      );

      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        address,
        VYPER_STANDARD_JSON_CONTRACT.expectedStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
        false,
      );
    });

    it(`Non-Session: Should import a contract with malformed version field from Etherscan for ${testChainId} and verify the contract, finding a ${MALFORMED_VERSION_CONTRACT.expectedStatus} match`, (done) => {
      const address = deployments.MALFORMED_VERSION_CONTRACT!.address;
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        address,
        MALFORMED_VERSION_CONTRACT.etherscanResponse,
      );

      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        address,
        MALFORMED_VERSION_CONTRACT.expectedStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
        false,
      );
    });

    // Non-session's default is `chain` but should also work with `chainId`
    it("should also work with `chainId` instead of `chain`", (done) => {
      const address = deployments.SINGLE_CONTRACT!.address;
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        address,
        SINGLE_CONTRACT.etherscanResponse,
      );

      chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("address", address)
        .field("chainId", testChainId)
        .end(async (err, res) => {
          await assertVerification(
            serverFixture,
            err,
            res,
            () => {
              chai.expect(nockScope.isDone()).to.equal(true);
              done();
            },
            address,
            testChainId,
            SINGLE_CONTRACT.expectedStatus,
          );
        });
    });

    it("should support a custom api key", (done) => {
      const address = deployments.SINGLE_CONTRACT!.address;
      const apiKey = "TEST";
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        address,
        INVALID_API_KEY_RESPONSE,
        apiKey,
      );
      chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("address", address)
        .field("chainId", testChainId)
        .field("apiKey", apiKey)
        .end((err, res) => {
          chai
            .expect(res.body.error)
            .to.equal(
              "Error in Etherscan API response. Result message: Invalid API Key",
            );
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        });
    });

    it("should fail by exceeding rate limit on etherscan APIs", async () => {
      const address = deployments.MULTIPLE_CONTRACT!.address;
      const nockScope = mockEtherscanApi(
        serverFixture.sourcifyChainsMap[testChainId],
        address,
        RATE_LIMIT_REACHED_RESPONSE,
      );
      const response = await chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("address", address)
        .field("chain", testChainId);
      assertEtherscanError(
        null,
        response,
        "Etherscan API rate limit reached, try later.",
        StatusCodes.TOO_MANY_REQUESTS,
      );
      chai.expect(nockScope.isDone()).to.equal(true);
    });
  });
});
