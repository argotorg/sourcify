import chai from "chai";
import chaiHttp from "chai-http";
import sinon from "sinon";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import {
  hookIntoVerificationWorkerRun,
  waitSecs,
} from "../../../helpers/helpers";
import { SourcifyDatabaseService } from "../../../../src/server/services/storageServices/SourcifyDatabaseService";
import { MockVerificationExport } from "../../../helpers/mocks";
import { assertJobVerification } from "../../../helpers/assertions";

chai.use(chaiHttp);

describe.only("POST /v2/verify/similarity/:chainId/:address", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  afterEach(() => {
    sandbox.restore();
  });
  it("should store a job error when no candidates are found", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/similarity/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send();

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
      .send();

    chai.expect(verifyRes.status).to.equal(202);
    chai.expect(verifyRes.body).to.have.property("verificationId");

    // We need to wait because `getSimilarityCandidatesByRuntimeCode` is delaying the job push to the queue
    await waitSecs(1);

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
