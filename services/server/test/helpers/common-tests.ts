import chai from "chai";
import { ServerFixture } from "./ServerFixture";
import chaiHttp from "chai-http";
import { hookIntoVerificationWorkerRun } from "./helpers";

chai.use(chaiHttp);

export async function testAlreadyBeingVerified(
  serverFixture: ServerFixture,
  makeWorkersWait: ReturnType<typeof hookIntoVerificationWorkerRun>,
  endpoint: string,
  postBody: Record<string, any>,
) {
  makeWorkersWait();

  // First verification request
  const verifyRes1 = await chai
    .request(serverFixture.server.app)
    .post(endpoint)
    .send(postBody);

  chai.expect(verifyRes1.status).to.equal(202);

  // Second verification request before the first one completes
  const verifyRes2 = await chai
    .request(serverFixture.server.app)
    .post(endpoint)
    .send(postBody);

  chai.expect(verifyRes2.status).to.equal(429);
  chai
    .expect(verifyRes2.body.customCode)
    .to.equal("duplicate_verification_request");
  chai.expect(verifyRes2.body).to.have.property("errorId");
  chai.expect(verifyRes2.body).to.have.property("message");
}

export async function testAlreadyVerified(
  serverFixture: ServerFixture,
  makeWorkersWait: ReturnType<typeof hookIntoVerificationWorkerRun>,
  endpoint: string,
  postBody: Record<string, any>,
  testChainId: string,
  testAddress: string,
) {
  const { resolveWorkers, runTaskStub } = makeWorkersWait();

  // First verification request
  const verifyRes1 = await chai
    .request(serverFixture.server.app)
    .post(endpoint)
    .send(postBody);

  chai.expect(verifyRes1.status).to.equal(202);

  await resolveWorkers();
  const contractRes = await chai
    .request(serverFixture.server.app)
    .get(`/v2/contract/${testChainId}/${testAddress}`);

  chai.expect(contractRes.status).to.equal(200);
  chai.expect(contractRes.body.match).to.equal("exact_match");

  runTaskStub.restore();
  makeWorkersWait();

  // Second verification
  const verifyRes2 = await chai
    .request(serverFixture.server.app)
    .post(endpoint)
    .send(postBody);

  chai.expect(verifyRes2.status).to.equal(409);
  chai.expect(verifyRes2.body.customCode).to.equal("already_verified");
  chai.expect(verifyRes2.body).to.have.property("errorId");
  chai.expect(verifyRes2.body).to.have.property("message");
}
