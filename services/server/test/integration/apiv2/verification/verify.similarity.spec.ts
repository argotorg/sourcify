import chai from "chai";
import chaiHttp from "chai-http";
import sinon from "sinon";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import {
  deployFromAbiAndBytecodeForCreatorTxHash,
  hookIntoVerificationWorkerRun,
} from "../../../helpers/helpers";
import { SourcifyDatabaseService } from "../../../../src/server/services/storageServices/SourcifyDatabaseService";
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
    chai.expect(workerInput).to.include({
      creatorTxHash: customCreationHash,
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

  it("should return an error when fetching the runtime bytecode fails", async () => {
    const getBytecodeStub = sandbox
      .stub(
        serverFixture.server.chainRepository.sourcifyChainMap[
          chainFixture.chainId
        ],
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
        serverFixture.server.chainRepository.sourcifyChainMap[
          chainFixture.chainId
        ],
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

  it("should return a 404 when the chain is not found", async function () {
    const unknownChainId = "5";
    const chainMap = serverFixture.server.chainRepository.sourcifyChainMap;
    sandbox.stub(chainMap, unknownChainId).value(undefined);

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${unknownChainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({});

    chai.expect(verifyRes.status).to.equal(404);
    chai.expect(verifyRes.body.customCode).to.equal("unsupported_chain");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it.only("should return a 429 if the contract is being verified at the moment already", async () => {
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
