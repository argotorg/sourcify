import chai from "chai";
import chaiHttp from "chai-http";
import sinon from "sinon";
import type { VerificationErrorCode } from "../../../../src/server/apiv2/errors";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import {
  deployFromAbiAndBytecodeForCreatorTxHash,
  hookIntoVerificationWorkerRun,
} from "../../../helpers/helpers";
import type { SourcifyDatabaseService } from "../../../../src/server/services/storageServices/SourcifyDatabaseService";
import { MockVerificationExport } from "../../../helpers/mocks";
import { assertJobVerification } from "../../../helpers/assertions";
import {
  testAlreadyBeingVerified,
  testAlreadyVerified,
} from "../../../helpers/common-tests";

chai.use(chaiHttp);

describe("POST /v2/verify/similarity/:chainId/:address", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  afterEach(() => {
    sandbox.restore();
  });
  it("should forward creationTransactionHash to the worker", async () => {
    const databaseService = serverFixture.server.services.storage.rwServices[
      "SourcifyDatabase"
    ] as SourcifyDatabaseService;
    const verification = structuredClone(MockVerificationExport);
    verification.address = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
    await databaseService.storeVerification(verification);

    const { resolveWorkers, runTaskStub } = makeWorkersWait();
    const customCreationHash = "0x" + "1".repeat(64);

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({ creationTransactionHash: customCreationHash });

    await resolveWorkers();
    chai.expect(verifyRes.status).to.equal(202);
    chai.expect(runTaskStub.calledOnce).to.be.true;
    const [workerInput] = runTaskStub.firstCall.args;
    chai.expect(workerInput.creationData).to.include({
      creationTransactionHash: customCreationHash,
    });
  });
  it("should store a job error when no candidates are found", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    chai.expect(verifyRes.status).to.equal(202);
    chai.expect(verifyRes.body).to.have.property("verificationId");

    await resolveWorkers();
    const jobRes = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${verifyRes.body.verificationId}`);

    chai.expect(jobRes.status).to.equal(200);
    chai.expect(jobRes.body.isJobCompleted).to.be.true;
    chai.expect(jobRes.body.error).to.deep.include({
      customCode: "no_similar_match_found",
    });
    chai.expect(jobRes.body.contract).to.deep.include({
      chainId: chainFixture.chainId,
      address: chainFixture.defaultContractAddress,
      match: null,
      creationMatch: null,
      runtimeMatch: null,
    });
  });

  it("should reject an immediate retry after a completed no-match similarity job without repeating work", async () => {
    const { resolveWorkers } = makeWorkersWait();
    const databaseService = serverFixture.server.services.storage.rwServices[
      "SourcifyDatabase"
    ] as SourcifyDatabaseService;
    const getBytecodeSpy = sandbox.spy(
      serverFixture.sourcifyChainsMap[chainFixture.chainId],
      "getBytecode",
    );
    const candidateSearchSpy = sandbox.spy(
      databaseService,
      "getSimilarityCandidateIdsByRuntimeCode",
    );
    const endpoint = `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`;
    const firstResponse = await chai
      .request(serverFixture.server.app)
      .post(endpoint)
      .send({});
    chai.expect(firstResponse.status).to.equal(202);
    await resolveWorkers();
    const jobResponse = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${firstResponse.body.verificationId}`);
    chai.expect(jobResponse.body.isJobCompleted).to.be.true;
    chai
      .expect(jobResponse.body.error.customCode)
      .to.equal("no_similar_match_found");

    // Clear incidental RPC calls from the initial request's middleware.
    getBytecodeSpy.resetHistory();
    const retryResponse = await chai
      .request(serverFixture.server.app)
      .post(endpoint)
      .send({});
    chai.expect(retryResponse.status).to.equal(429);
    chai
      .expect(retryResponse.body.customCode)
      .to.equal("similarity_recently_failed");
    chai
      .expect(Number(retryResponse.headers["retry-after"]))
      .to.be.within(1, 600);
    chai.expect(retryResponse.body).not.to.have.property("verificationId");
    chai.expect(getBytecodeSpy.called).to.be.false;
    chai.expect(candidateSearchSpy.calledOnce).to.be.true;
    const jobs = await serverFixture.sourcifyDatabase.query(
      "SELECT id FROM verification_jobs",
    );
    chai.expect(jobs.rowCount).to.equal(1);
  });

  it("should reject a retry after real candidate recompilation finishes without a match", async () => {
    const databaseService = serverFixture.server.services.storage.rwServices[
      "SourcifyDatabase"
    ] as SourcifyDatabaseService;
    const verification = structuredClone(MockVerificationExport);
    verification.address = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
    await databaseService.storeVerification(verification);

    // Change SLOAD's slot after the indexed 75-byte prefix, preserving the
    // candidate lookup but preventing a runtime or creation-bytecode match.
    const bytecode = chainFixture.defaultContractArtifact.bytecode.replace(
      "6000805490509056",
      "6001805490509056",
    );
    chai
      .expect(bytecode)
      .not.to.equal(chainFixture.defaultContractArtifact.bytecode);
    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        chainFixture.defaultContractArtifact.abi,
        bytecode,
      );
    const candidateSearchSpy = sandbox.spy(
      databaseService,
      "getSimilarityCandidateIdsByRuntimeCode",
    );
    const { resolveWorkers, runTaskStub } = makeWorkersWait();
    const endpoint = `/v2/verify/similarity/${chainFixture.chainId}/${contractAddress}`;
    const response = await chai
      .request(serverFixture.server.app)
      .post(endpoint)
      .send({ creationTransactionHash: txHash });
    chai.expect(response.status).to.equal(202);
    await resolveWorkers();
    const jobResponse = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${response.body.verificationId}`);
    chai.expect(jobResponse.body.isJobCompleted).to.be.true;
    chai
      .expect(jobResponse.body.error.customCode)
      .to.equal("no_similar_match_found");
    chai.expect(runTaskStub.calledOnce).to.be.true;
    chai.expect(runTaskStub.firstCall.args[0].candidates).to.have.length(1);

    const retryResponse = await chai
      .request(serverFixture.server.app)
      .post(endpoint)
      .send({ creationTransactionHash: txHash });
    chai.expect(retryResponse.status).to.equal(429);
    chai
      .expect(retryResponse.body.customCode)
      .to.equal("similarity_recently_failed");
    chai.expect(candidateSearchSpy.calledOnce).to.be.true;
    chai.expect(runTaskStub.calledOnce).to.be.true;
  });

  it("should store a similarity_search_timeout error when the candidate id query times out", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const databaseService = serverFixture.server.services.storage.rwServices[
      "SourcifyDatabase"
    ] as SourcifyDatabaseService;
    const timeoutError = new Error(
      "canceling statement due to statement timeout",
    );
    (timeoutError as any).code = "57014";
    sandbox
      .stub(databaseService, "getSimilarityCandidateIdsByRuntimeCode")
      .rejects(timeoutError);

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    chai.expect(verifyRes.status).to.equal(202);

    await resolveWorkers();
    const jobRes = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${verifyRes.body.verificationId}`);

    chai.expect(jobRes.status).to.equal(200);
    chai.expect(jobRes.body.isJobCompleted).to.be.true;
    chai.expect(jobRes.body.error).to.deep.include({
      customCode: "similarity_search_timeout",
    });
  });

  describe("completed similarity failure cooldown", () => {
    async function recordFailure(
      errorCode: VerificationErrorCode,
      completedAt = new Date(),
      chainId = chainFixture.chainId,
      address = chainFixture.defaultContractAddress,
      endpoint = `/v2/verify/similarity/${chainId}/${address}`,
    ) {
      const databaseService = serverFixture.server.services.storage.rwServices[
        "SourcifyDatabase"
      ] as SourcifyDatabaseService;
      const id = await databaseService.storeVerificationJob(
        new Date(completedAt.getTime() - 7200000),
        chainId,
        address,
        endpoint,
      );
      await databaseService.setJobError(id, completedAt, {
        customCode: errorCode,
        errorId: "00000000-0000-4000-8000-000000000001",
      });
    }

    async function submit() {
      const response = await chai
        .request(serverFixture.server.app)
        .post(
          `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress.toLowerCase()}`,
        )
        .send({});
      await Promise.all(
        serverFixture.server.services.verification["runningTasks"],
      );
      return response;
    }

    it("should use completion time and preserve the remaining cooldown for a differently cased address", async () => {
      const now = Date.now();
      sandbox.useFakeTimers({ now, toFake: ["Date"] });
      await recordFailure("no_similar_match_found", new Date(now - 120500));
      const response = await submit();
      chai.expect(response.status).to.equal(429);
      chai.expect(response.headers["retry-after"]).to.equal("480");
      const jobs = await serverFixture.sourcifyDatabase.query(
        "SELECT id FROM verification_jobs",
      );
      chai.expect(jobs.rowCount).to.equal(1);
    });

    it("should allow a retry exactly when the cooldown expires", async () => {
      const now = Date.now();
      sandbox.useFakeTimers({ now, toFake: ["Date"] });
      await recordFailure("no_similar_match_found", new Date(now - 600000));
      chai.expect((await submit()).status).to.equal(202);
    });

    for (const errorCode of [
      "similarity_search_timeout",
      "internal_error",
      "cannot_fetch_bytecode",
    ] as const) {
      it(`should allow an immediate retry after ${errorCode}`, async () => {
        await recordFailure(errorCode);
        chai.expect((await submit()).status).to.equal(202);
      });
    }

    it("should ignore a failure from a different verification endpoint", async () => {
      await recordFailure(
        "no_similar_match_found",
        new Date(),
        undefined,
        undefined,
        "/v2/verify/metadata/31337/contract",
      );
      chai.expect((await submit()).status).to.equal(202);
    });

    it("should not apply another chain's cooldown", async () => {
      await recordFailure("no_similar_match_found", new Date(), "1");
      chai.expect((await submit()).status).to.equal(202);
    });

    it("should not apply another address's cooldown", async () => {
      await recordFailure(
        "no_similar_match_found",
        new Date(),
        undefined,
        "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
      );
      chai.expect((await submit()).status).to.equal(202);
    });
  });

  it("should store a similarity_search_timeout error when the candidate batch query times out", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const databaseService = serverFixture.server.services.storage.rwServices[
      "SourcifyDatabase"
    ] as SourcifyDatabaseService;
    // Seed a verified contract so that candidate ids are found
    const verification = structuredClone(MockVerificationExport);
    verification.address = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
    await databaseService.storeVerification(verification);

    const timeoutError = new Error(
      "canceling statement due to statement timeout",
    );
    (timeoutError as any).code = "57014";
    sandbox
      .stub(databaseService, "getSimilarityCandidatesByCompilationIds")
      .rejects(timeoutError);

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    chai.expect(verifyRes.status).to.equal(202);

    await resolveWorkers();
    const jobRes = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${verifyRes.body.verificationId}`);

    chai.expect(jobRes.status).to.equal(200);
    chai.expect(jobRes.body.isJobCompleted).to.be.true;
    chai.expect(jobRes.body.error).to.deep.include({
      customCode: "similarity_search_timeout",
    });
  });

  it("should return an error when fetching the runtime bytecode fails", async () => {
    const getBytecodeStub = sandbox
      .stub(
        serverFixture.sourcifyChainsMap[chainFixture.chainId],
        "getBytecode",
      )
      .rejects(new Error("RPC failure"));

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    chai.expect(getBytecodeStub.calledOnce).to.be.true;
    chai.expect(verifyRes.status).to.equal(502);
    chai
      .expect(verifyRes.body.message)
      .to.equal(
        `Failed to get bytecode for chain ${chainFixture.chainId} and address ${chainFixture.defaultContractAddress}.`,
      );
    chai.expect(verifyRes.body).to.not.have.property("verificationId");
  });

  it("should return an error when fetching the runtime bytecode fails", async () => {
    const getBytecodeStub = sandbox
      .stub(
        serverFixture.sourcifyChainsMap[chainFixture.chainId],
        "getBytecode",
      )
      .resolves("0x");

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    chai.expect(getBytecodeStub.calledOnce).to.be.true;
    chai.expect(verifyRes.status).to.equal(404);
    chai
      .expect(verifyRes.body.message)
      .to.equal(
        `There is no bytecode at address ${chainFixture.defaultContractAddress} on chain ${chainFixture.chainId}.`,
      );
    chai.expect(verifyRes.body).to.not.have.property("verificationId");
  });

  it("should return a 400 when the bytecode is shorter than the similarity prefix", async () => {
    const getBytecodeStub = sandbox
      .stub(
        serverFixture.sourcifyChainsMap[chainFixture.chainId],
        "getBytecode",
      )
      // 45-byte EIP-1167 style bytecode, below the 75-byte prefix length
      .resolves("0x" + "ff".repeat(45));

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    chai.expect(getBytecodeStub.calledOnce).to.be.true;
    chai.expect(verifyRes.status).to.equal(400);
    chai
      .expect(verifyRes.body.customCode)
      .to.equal("bytecode_too_short_for_similarity");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
    chai.expect(verifyRes.body).to.not.have.property("verificationId");
  });

  it("should return a 400 if the address is invalid", async () => {
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/similarity/${chainFixture.chainId}/invalid-address`)
      .send({});

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 400 when the chain is not found", async function () {
    const unknownChainId = "1337";
    const chainMap = serverFixture.sourcifyChainsMap;
    sandbox.stub(chainMap, unknownChainId).value(undefined);

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${unknownChainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("unsupported_chain");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 429 if the contract is being verified at the moment already", async () => {
    const databaseService = serverFixture.server.services.storage.rwServices[
      "SourcifyDatabase"
    ] as SourcifyDatabaseService;

    // Similarity search completes immediately with an error when no candidates exist,
    // never touching the workerPool (so makeWorkersWait can't hold it),
    // therefore we seed one to keep the first request's job running and trigger the duplicate check.
    const verification = structuredClone(MockVerificationExport);
    verification.address = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
    await databaseService.storeVerification(verification);

    await testAlreadyBeingVerified(
      serverFixture,
      makeWorkersWait,
      `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      {},
    );
  });

  it("should return a 409 if the contract is already verified", async () => {
    const databaseService = serverFixture.server.services.storage.rwServices[
      "SourcifyDatabase"
    ] as SourcifyDatabaseService;

    const verification = structuredClone(MockVerificationExport);
    verification.address = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
    await databaseService.storeVerification(verification);

    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        chainFixture.defaultContractArtifact.abi,
        chainFixture.defaultContractArtifact.bytecode,
      );

    await testAlreadyVerified(
      serverFixture,
      makeWorkersWait,
      `/v2/verify/similarity/${chainFixture.chainId}/${contractAddress}`,
      {
        creationTransactionHash: txHash,
      },
      chainFixture.chainId,
      contractAddress,
    );
  });

  it("should verify using a similar candidate stored in the database", async () => {
    const databaseService = serverFixture.server.services.storage.rwServices[
      "SourcifyDatabase"
    ] as SourcifyDatabaseService;

    const verification = structuredClone(MockVerificationExport);

    // here I change the address on purpose to simulate a different contract
    verification.address = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";

    await databaseService.storeVerification(verification);

    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    chai.expect(verifyRes.status).to.equal(202);
    chai.expect(verifyRes.body).to.have.property("verificationId");

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      chainFixture.chainId,
      chainFixture.defaultContractAddress,
      "exact_match",
    );
  });
});
