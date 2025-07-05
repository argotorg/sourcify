import { expect, use, request } from "chai";
import chaiHttp from "chai-http";
import {
  hookIntoVerificationWorkerRun,
  unusedAddress,
} from "../../../helpers/helpers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import { assertJobVerification } from "../../../helpers/assertions";
import sinon from "sinon";
import {
  mockEtherscanApi,
  MULTIPLE_CONTRACT_RESPONSE,
  SINGLE_CONTRACT_RESPONSE,
  STANDARD_JSON_CONTRACT_RESPONSE,
  VYPER_SINGLE_CONTRACT_RESPONSE,
  VYPER_STANDARD_JSON_CONTRACT_RESPONSE,
  UNVERIFIED_CONTRACT_RESPONSE,
  INVALID_API_KEY_RESPONSE,
  RATE_LIMIT_REACHED_RESPONSE,
  STANDARD_JSON_CONTRACT_EXACT_MATCH_RESPONSE,
} from "../../../helpers/etherscanResponseMocks";
import { sourcifyChainsMap } from "../../../../src/sourcify-chains";
import testContracts from "../../../helpers/etherscanInstanceContracts.json";
import { VerificationStatus } from "@ethereum-sourcify/lib-sourcify";
import { toMatchLevel } from "../../../../src/server/services/utils/util";
import {
  testAlreadyBeingVerified,
  testAlreadyVerified,
} from "../../../helpers/common-tests";

use(chaiHttp);

describe("POST /v2/verify/etherscan/:chainId/:address", function () {
  // Don't run if it's an external PR. Etherscan tests need API keys that can't be exposed to external PRs.
  if (process.env.CIRCLE_PR_REPONAME !== undefined) {
    return;
  }

  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);
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

  afterEach(async () => {
    sandbox.restore();
  });

  it("should import a contract from Etherscan via single contract response", async () => {
    const testAddress = singleContract.address;
    const expectedStatus = toMatchLevel(
      singleContract.expectedStatus as VerificationStatus,
    );

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      SINGLE_CONTRACT_RESPONSE,
    );

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${testChainId}/${testAddress}`)
      .send({});

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      testChainId,
      testAddress,
      expectedStatus,
    );
  });

  it("should import a contract from Etherscan via multiple contract response", async () => {
    const testAddress = multipleContract.address;
    const expectedStatus = toMatchLevel(
      multipleContract.expectedStatus as VerificationStatus,
    );

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      MULTIPLE_CONTRACT_RESPONSE,
    );

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${testChainId}/${testAddress}`)
      .send({});

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      testChainId,
      testAddress,
      expectedStatus,
    );
  });

  it("should import a contract from Etherscan via standard json contract response", async () => {
    const testAddress = standardJsonContract.address;
    const expectedStatus = toMatchLevel(
      standardJsonContract.expectedStatus as VerificationStatus,
    );

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      STANDARD_JSON_CONTRACT_RESPONSE,
    );

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${testChainId}/${testAddress}`)
      .send({});

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      testChainId,
      testAddress,
      expectedStatus,
    );
  });

  it("should import a contract from Etherscan via vyper single contract response", async () => {
    const testAddress = "0x7BA33456EC00812C6B6BB6C1C3dfF579c34CC2cc";
    const expectedStatus = "match";

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      VYPER_SINGLE_CONTRACT_RESPONSE,
    );

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${testChainId}/${testAddress}`)
      .send({});

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      testChainId,
      testAddress,
      expectedStatus,
    );
  });

  it("should import a contract from Etherscan via vyper standard json contract response", async () => {
    const testAddress = "0x2dFd89449faff8a532790667baB21cF733C064f2";
    const expectedStatus = "match";

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      VYPER_STANDARD_JSON_CONTRACT_RESPONSE,
    );

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${testChainId}/${testAddress}`)
      .send({});

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      testChainId,
      testAddress,
      expectedStatus,
    );
  });

  it("should allow for using a custom api key", async () => {
    const apiKey = "TEST";
    const testAddress = singleContract.address;
    const expectedStatus = toMatchLevel(
      singleContract.expectedStatus as VerificationStatus,
    );

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      SINGLE_CONTRACT_RESPONSE,
      apiKey,
    );

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${testChainId}/${testAddress}`)
      .send({ apiKey });

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      testChainId,
      testAddress,
      expectedStatus,
    );
  });

  it("should return a 404 if the contract is not verified on Etherscan", async () => {
    const testAddress = unusedAddress;

    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      UNVERIFIED_CONTRACT_RESPONSE,
    );

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${testChainId}/${testAddress}`)
      .send({});

    expect(verifyRes.status).to.equal(404);
    expect(verifyRes.body.customCode).to.equal("not_etherscan_verified");
    expect(verifyRes.body).to.have.property("errorId");
    expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 502 if an invalid api key is provided", async () => {
    const apiKey = "TEST";
    const testAddress = singleContract.address;

    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      INVALID_API_KEY_RESPONSE,
      apiKey,
    );

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${testChainId}/${testAddress}`)
      .send({ apiKey });

    expect(verifyRes.status).to.equal(502);
    expect(verifyRes.body.customCode).to.equal("etherscan_request_failed");
    expect(verifyRes.body).to.have.property("errorId");
    expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 429 if the Etherscan API rate limit is reached", async () => {
    const testAddress = singleContract.address;

    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      RATE_LIMIT_REACHED_RESPONSE,
    );

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${testChainId}/${testAddress}`)
      .send({});

    expect(verifyRes.status).to.equal(429);
    expect(verifyRes.body.customCode).to.equal("etherscan_limit");
    expect(verifyRes.body).to.have.property("errorId");
    expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 429 if the contract is being verified at the moment already", async () => {
    const testAddress = singleContract.address;
    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      SINGLE_CONTRACT_RESPONSE,
    );

    await testAlreadyBeingVerified(
      serverFixture,
      makeWorkersWait,
      `/v2/verify/etherscan/${testChainId}/${testAddress}`,
      {},
    );
  });

  it("should return a 409 if the contract is already verified", async () => {
    // Must be an exact match for this test
    const testAddress = "0xbD65e16894EF6Dd9C58e4bbeC55D7E33769f43D9";
    mockEtherscanApi(
      sourcifyChainsMap[testChainId],
      testAddress,
      STANDARD_JSON_CONTRACT_EXACT_MATCH_RESPONSE,
    );

    await testAlreadyVerified(
      serverFixture,
      makeWorkersWait,
      `/v2/verify/etherscan/${testChainId}/${testAddress}`,
      {},
      testChainId,
      testAddress,
    );
  });

  it("should return a 400 when the address is invalid", async function () {
    const invalidAddress =
      chainFixture.defaultContractAddress.slice(0, 41) + "G";

    const verifyRes = await request(serverFixture.server.app)
      .post(`/v2/verify/etherscan/${chainFixture.chainId}/${invalidAddress}`)
      .send({});

    expect(verifyRes.status).to.equal(400);
    expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    expect(verifyRes.body).to.have.property("errorId");
    expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 404 when the chain is not found", async function () {
    const chainMap = serverFixture.server.chainRepository.sourcifyChainMap;
    sandbox.stub(chainMap, testChainId).value(undefined);

    const verifyRes = await request(serverFixture.server.app)
      .post(
        `/v2/verify/etherscan/${testChainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    expect(verifyRes.status).to.equal(404);
    expect(verifyRes.body.customCode).to.equal("unsupported_chain");
    expect(verifyRes.body).to.have.property("errorId");
    expect(verifyRes.body).to.have.property("message");
  });
});
