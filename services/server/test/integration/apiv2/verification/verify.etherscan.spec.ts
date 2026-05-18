import { expect, use, request } from "chai";
import chaiHttp from "chai-http";
import nock from "nock";
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
  deployEtherscanFixtures,
  SINGLE_CONTRACT,
  MULTIPLE_CONTRACT,
  STANDARD_JSON_CONTRACT,
  VYPER_SINGLE_CONTRACT,
  VYPER_STANDARD_JSON_CONTRACT,
  MALFORMED_VERSION_CONTRACT,
  STANDARD_JSON_CONTRACT_EXACT_MATCH,
  UNVERIFIED_CONTRACT_RESPONSE,
  INVALID_API_KEY_RESPONSE,
  RATE_LIMIT_REACHED_RESPONSE,
} from "../../../helpers/etherscanTestCases";
import type { EtherscanDeployments } from "../../../helpers/etherscanTestCases";
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { toMatchLevel } from "../../../../src/server/services/utils/util";
import { LOCAL_CHAINS } from "../../../../src/sourcify-chains";
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
    etherscanApi: {
      supported: true,
      apiKeyEnvName: "ETHERSCAN_API_KEY",
    },
  });
  const serverFixture = new ServerFixture({
    chains: {
      ...Object.fromEntries(LOCAL_CHAINS.map((c) => [c.chainId.toString(), c])),
      "1": mainnetStub,
    },
  });
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);
  const testChainId = "1";
  let deployments: EtherscanDeployments;

  before(async () => {
    deployments = await deployEtherscanFixtures(chainFixture.localSigner);
  });

  afterEach(async () => {
    sandbox.restore();
    nock.cleanAll();
  });

  it("should import a contract from Etherscan via single contract response", async () => {
    const testAddress = deployments.SINGLE_CONTRACT!.address;
    const expectedStatus = toMatchLevel(SINGLE_CONTRACT.expectedStatus);

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
      testAddress,
      SINGLE_CONTRACT.etherscanResponse,
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
    const testAddress = deployments.MULTIPLE_CONTRACT!.address;
    const expectedStatus = toMatchLevel(MULTIPLE_CONTRACT.expectedStatus);

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
      testAddress,
      MULTIPLE_CONTRACT.etherscanResponse,
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
    const testAddress = deployments.STANDARD_JSON_CONTRACT!.address;
    const expectedStatus = toMatchLevel(STANDARD_JSON_CONTRACT.expectedStatus);

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
      testAddress,
      STANDARD_JSON_CONTRACT.etherscanResponse,
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
    const testAddress = deployments.VYPER_SINGLE_CONTRACT!.address;
    const expectedStatus = toMatchLevel(VYPER_SINGLE_CONTRACT.expectedStatus);

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
      testAddress,
      VYPER_SINGLE_CONTRACT.etherscanResponse,
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
      false,
    );
  });

  it("should import a contract from Etherscan via vyper standard json contract response", async () => {
    const testAddress = deployments.VYPER_STANDARD_JSON_CONTRACT!.address;
    const expectedStatus = toMatchLevel(
      VYPER_STANDARD_JSON_CONTRACT.expectedStatus,
    );

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
      testAddress,
      VYPER_STANDARD_JSON_CONTRACT.etherscanResponse,
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
      false,
    );
  });

  it("should import a contract with malformed version field from Etherscan via single contract response", async () => {
    const testAddress = deployments.MALFORMED_VERSION_CONTRACT!.address;
    const expectedStatus = toMatchLevel(
      MALFORMED_VERSION_CONTRACT.expectedStatus,
    );

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
      testAddress,
      MALFORMED_VERSION_CONTRACT.etherscanResponse,
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
      false,
    );
  });

  it("should allow for using a custom api key", async () => {
    const apiKey = "TEST";
    const testAddress = deployments.SINGLE_CONTRACT!.address;
    const expectedStatus = toMatchLevel(SINGLE_CONTRACT.expectedStatus);

    const { resolveWorkers } = makeWorkersWait();
    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
      testAddress,
      SINGLE_CONTRACT.etherscanResponse,
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
      serverFixture.sourcifyChainsMap[testChainId],
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
    const testAddress = deployments.SINGLE_CONTRACT!.address;

    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
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
    const testAddress = deployments.SINGLE_CONTRACT!.address;

    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
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
    const testAddress = deployments.SINGLE_CONTRACT!.address;
    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
      testAddress,
      SINGLE_CONTRACT.etherscanResponse,
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
    const testAddress = deployments.STANDARD_JSON_CONTRACT_EXACT_MATCH!.address;
    mockEtherscanApi(
      serverFixture.sourcifyChainsMap[testChainId],
      testAddress,
      STANDARD_JSON_CONTRACT_EXACT_MATCH.etherscanResponse,
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

  it("should return a 400 when the chain is not found", async function () {
    const chainMap = serverFixture.sourcifyChainsMap;
    sandbox.stub(chainMap, testChainId).value(undefined);

    const verifyRes = await request(serverFixture.server.app)
      .post(
        `/v2/verify/etherscan/${testChainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    expect(verifyRes.status).to.equal(400);
    expect(verifyRes.body.customCode).to.equal("unsupported_chain");
    expect(verifyRes.body).to.have.property("errorId");
    expect(verifyRes.body).to.have.property("message");
  });
});
