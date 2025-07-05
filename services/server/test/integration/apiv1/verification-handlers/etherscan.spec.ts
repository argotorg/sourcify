import chai from "chai";
import chaiHttp from "chai-http";
import { StatusCodes } from "http-status-codes";
import {
  assertVerification,
  assertValidationError,
  assertVerificationSession,
} from "../../../helpers/assertions";
import { sourcifyChainsMap } from "../../../../src/sourcify-chains";
import testContracts from "../../../helpers/etherscanInstanceContracts.json";
import {
  unusedAddress,
  invalidAddress,
  unsupportedChain,
  verifyAndAssertEtherscanSession,
  verifyAndAssertEtherscanViaApiV1,
} from "../../../helpers/helpers";
import type { Response } from "superagent";
import { ServerFixture } from "../../../helpers/ServerFixture";
import nock from "nock";
import {
  INVALID_API_KEY_RESPONSE,
  mockEtherscanApi,
  MULTIPLE_CONTRACT_RESPONSE,
  RATE_LIMIT_REACHED_RESPONSE,
  SINGLE_CONTRACT_RESPONSE,
  STANDARD_JSON_CONTRACT_RESPONSE,
  UNVERIFIED_CONTRACT_RESPONSE,
  VYPER_SINGLE_CONTRACT_RESPONSE,
  VYPER_STANDARD_JSON_CONTRACT_RESPONSE,
} from "../../../helpers/etherscanResponseMocks";
import { VerificationStatus } from "@ethereum-sourcify/lib-sourcify";

chai.use(chaiHttp);

const CUSTOM_PORT = 5678;

describe("Import From Etherscan and Verify", function () {
  // Don't run if it's an external PR. Etherscan tests need API keys that can't be exposed to external PRs.
  if (process.env.CIRCLE_PR_REPONAME !== undefined) {
    return;
  }

  const serverFixture = new ServerFixture({ port: CUSTOM_PORT });

  const testChainId = "1";
  const singleContract = testContracts[testChainId].find(
    (contract) => contract.type === "single",
  )!;
  const multipleContract = testContracts[testChainId].find(
    (contract) => contract.type === "multiple",
  )!;
  const standardJsonContract = testContracts[testChainId].find(
    (contract) => contract.type === "standard-json",
  )!;

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
        sourcifyChainsMap[testChainId],
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

    it(`Non-Session: Should import a single contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a ${singleContract.expectedStatus} match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        singleContract.address,
        SINGLE_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        singleContract.address,
        singleContract.expectedStatus as VerificationStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Non-Session: Should import a multiple contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a ${multipleContract.expectedStatus} match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        multipleContract.address,
        MULTIPLE_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        multipleContract.address,
        multipleContract.expectedStatus as VerificationStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Non-Session: Should import a standard-json contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a ${standardJsonContract.expectedStatus} match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        standardJsonContract.address,
        STANDARD_JSON_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        standardJsonContract.address,
        standardJsonContract.expectedStatus as VerificationStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Non-Session: Should import a Vyper single contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a partial match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        "0x7BA33456EC00812C6B6BB6C1C3dfF579c34CC2cc",
        VYPER_SINGLE_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        "0x7BA33456EC00812C6B6BB6C1C3dfF579c34CC2cc",
        "partial",
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Non-Session: Should import a Vyper standard-json contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a partial match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        "0x2dFd89449faff8a532790667baB21cF733C064f2",
        VYPER_STANDARD_JSON_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanViaApiV1(
        serverFixture,
        testChainId,
        "0x2dFd89449faff8a532790667baB21cF733C064f2",
        "partial",
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    // Non-session's default is `chain` but should also work with `chainId`
    it("should also work with `chainId` instead of `chain`", (done) => {
      const contract = singleContract;
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        contract.address,
        SINGLE_CONTRACT_RESPONSE,
      );
      chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("address", contract.address)
        .field("chainId", testChainId)
        .end(async (err, res) => {
          await assertVerification(
            null,
            err,
            res,
            () => {
              chai.expect(nockScope.isDone()).to.equal(true);
              done();
            },
            contract.address,
            testChainId,
            contract.expectedStatus as VerificationStatus,
          );
        });
    });

    it("should support a custom api key", (done) => {
      const contract = singleContract;
      const apiKey = "TEST";
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        contract.address,
        INVALID_API_KEY_RESPONSE,
        apiKey,
      );
      chai
        .request(serverFixture.server.app)
        .post("/verify/etherscan")
        .field("address", contract.address)
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
      const address = "0xB753548F6E010e7e680BA186F9Ca1BdAB2E90cf2";
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
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

  describe("Session API", () => {
    it("should fail for missing address", (done) => {
      chai
        .request(serverFixture.server.app)
        .post("/session/verify/etherscan/")
        .field("chainId", testChainId)
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
        .post("/session/verify/etherscan/")
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
        .post("/session/verify/etherscan")
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
        .post("/session/verify/etherscan")
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
        sourcifyChainsMap[testChainId],
        unusedAddress,
        UNVERIFIED_CONTRACT_RESPONSE,
      );
      chai
        .request(serverFixture.server.app)
        .post("/session/verify/etherscan")
        .field("address", unusedAddress)
        .field("chainId", testChainId)
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

    it("should support a custom api key", (done) => {
      const apiKey = "TEST";
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        unusedAddress,
        INVALID_API_KEY_RESPONSE,
        apiKey,
      );
      chai
        .request(serverFixture.server.app)
        .post("/session/verify/etherscan")
        .field("address", unusedAddress)
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

    it(`Session: Should import a single contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a ${singleContract.expectedStatus} match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        singleContract.address,
        SINGLE_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanSession(
        serverFixture,
        testChainId,
        singleContract.address,
        singleContract.expectedStatus as VerificationStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Session: Should import a multiple contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a ${multipleContract.expectedStatus} match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        multipleContract.address,
        MULTIPLE_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanSession(
        serverFixture,
        testChainId,
        multipleContract.address,
        multipleContract.expectedStatus as VerificationStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Session: Should import a standard-json contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a ${standardJsonContract.expectedStatus} match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        standardJsonContract.address,
        STANDARD_JSON_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanSession(
        serverFixture,
        testChainId,
        standardJsonContract.address,
        standardJsonContract.expectedStatus as VerificationStatus,
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Session: Should import a Vyper single contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a partial match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        "0x7BA33456EC00812C6B6BB6C1C3dfF579c34CC2cc",
        VYPER_SINGLE_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanSession(
        serverFixture,
        testChainId,
        "0x7BA33456EC00812C6B6BB6C1C3dfF579c34CC2cc",
        "partial",
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    it(`Session: Should import a Vyper standard-json contract from Etherscan for ${sourcifyChainsMap[testChainId].name} and verify the contract, finding a partial match`, (done) => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        "0x2dFd89449faff8a532790667baB21cF733C064f2",
        VYPER_STANDARD_JSON_CONTRACT_RESPONSE,
      );
      verifyAndAssertEtherscanSession(
        serverFixture,
        testChainId,
        "0x2dFd89449faff8a532790667baB21cF733C064f2",
        "partial",
        () => {
          chai.expect(nockScope.isDone()).to.equal(true);
          done();
        },
      );
    });

    // Session's default is `body.chainId` but should also work with `chain`
    it("should also work with `chain` instead of `chainId`", (done) => {
      const contract = singleContract;
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        contract.address,
        SINGLE_CONTRACT_RESPONSE,
      );
      chai
        .request(serverFixture.server.app)
        .post("/session/verify/etherscan")
        .field("address", contract.address)
        .field("chain", testChainId)
        .end(async (err, res) => {
          await assertVerificationSession(
            null,
            err,
            res,
            () => {
              chai.expect(nockScope.isDone()).to.equal(true);
              done();
            },
            contract.address,
            testChainId,
            contract.expectedStatus as VerificationStatus,
          );
        });
    });

    it("should fail by exceeding rate limit on etherscan APIs", async () => {
      const address = "0xB753548F6E010e7e680BA186F9Ca1BdAB2E90cf2";
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        address,
        RATE_LIMIT_REACHED_RESPONSE,
      );
      const response = await chai
        .request(serverFixture.server.app)
        .post("/session/verify/etherscan")
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
