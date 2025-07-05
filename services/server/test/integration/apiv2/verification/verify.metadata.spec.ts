import chai from "chai";
import chaiHttp from "chai-http";
import { hookIntoVerificationWorkerRun } from "../../../helpers/helpers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import { assertJobVerification } from "../../../helpers/assertions";
import sinon from "sinon";
import {
  testAlreadyBeingVerified,
  testAlreadyVerified,
} from "../../../helpers/common-tests";

chai.use(chaiHttp);

describe("POST /v2/verify/metadata/:chainId/:address", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  afterEach(() => {
    sandbox.restore();
  });

  it("should verify a contract via Solidity metadata", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/metadata/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        sources: {
          [Object.keys(chainFixture.defaultContractMetadataObject.sources)[0]]:
            chainFixture.defaultContractSource.toString(),
        },
        metadata: chainFixture.defaultContractMetadataObject,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      chainFixture.chainId,
      chainFixture.defaultContractAddress,
      "exact_match",
    );
  });

  it("should fetch the creation transaction hash if not provided", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/metadata/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        sources: {
          [Object.keys(chainFixture.defaultContractMetadataObject.sources)[0]]:
            chainFixture.defaultContractSource.toString(),
        },
        metadata: chainFixture.defaultContractMetadataObject,
      });

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      chainFixture.chainId,
      chainFixture.defaultContractAddress,
      "exact_match",
    );
  });

  it("should store a job error if the metadata validation fails", async () => {
    const { resolveWorkers } = makeWorkersWait();

    // Uses the modified source which doesn't match the hash in metadata
    const sourcePath = Object.keys(
      chainFixture.defaultContractMetadataObject.sources,
    )[0];
    const sources = {
      [sourcePath]: chainFixture.defaultContractModifiedSource.toString(),
    };
    const metadata = JSON.parse(
      JSON.stringify(chainFixture.defaultContractMetadataObject),
    );
    metadata.sources[sourcePath].content =
      chainFixture.defaultContractModifiedSource.toString();
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/metadata/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        sources,
        metadata,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(202);

    await resolveWorkers();

    const jobRes = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${verifyRes.body.verificationId}`);

    chai.expect(jobRes.status).to.equal(200);
    chai.expect(jobRes.body).to.include({
      isJobCompleted: true,
    });
    chai.expect(jobRes.body.error).to.exist;
    chai
      .expect(jobRes.body.error.customCode)
      .to.equal("missing_or_invalid_source");
    chai.expect(jobRes.body.error.errorData).to.deep.equal({
      missingSources: [],
      invalidSources: ["project:/contracts/Storage.sol"],
    });
    chai.expect(jobRes.body.contract).to.deep.equal({
      match: null,
      creationMatch: null,
      runtimeMatch: null,
      chainId: chainFixture.chainId,
      address: chainFixture.defaultContractAddress,
    });
  });

  it("should return a 429 if the contract is being verified at the moment already", async () => {
    await testAlreadyBeingVerified(
      serverFixture,
      makeWorkersWait,
      `/v2/verify/metadata/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      {
        sources: {
          [Object.keys(chainFixture.defaultContractMetadataObject.sources)[0]]:
            chainFixture.defaultContractSource.toString(),
        },
        metadata: chainFixture.defaultContractMetadataObject,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      },
    );
  });

  it("should return a 409 if the contract is already verified", async () => {
    await testAlreadyVerified(
      serverFixture,
      makeWorkersWait,
      `/v2/verify/metadata/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      {
        sources: {
          [Object.keys(chainFixture.defaultContractMetadataObject.sources)[0]]:
            chainFixture.defaultContractSource.toString(),
        },
        metadata: chainFixture.defaultContractMetadataObject,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      },
      chainFixture.chainId,
      chainFixture.defaultContractAddress,
    );
  });

  it("should return a 400 when the sources are missing", async () => {
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/metadata/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        metadata: chainFixture.defaultContractMetadataObject,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 400 when metadata is missing", async () => {
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/metadata/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        sources: {
          [Object.keys(chainFixture.defaultContractMetadataObject.sources)[0]]:
            chainFixture.defaultContractSource.toString(),
        },
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  ["compiler", "language", "settings", "sources"].forEach((field) => {
    it(`should return a 400 when metadata is invalid - missing ${field}`, async () => {
      const invalidMetadata = JSON.parse(
        JSON.stringify(chainFixture.defaultContractMetadataObject),
      );
      delete invalidMetadata[field];
      const verifyRes = await chai
        .request(serverFixture.server.app)
        .post(
          `/v2/verify/metadata/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
        )
        .send({
          sources: {
            [Object.keys(
              chainFixture.defaultContractMetadataObject.sources,
            )[0]]: chainFixture.defaultContractSource.toString(),
          },
          metadata: invalidMetadata,
          creationTransactionHash: chainFixture.defaultContractCreatorTx,
        });

      chai.expect(verifyRes.status).to.equal(400);
      chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
      chai.expect(verifyRes.body).to.have.property("errorId");
      chai.expect(verifyRes.body).to.have.property("message");
    });
  });

  it("should return a 400 when the address is invalid", async function () {
    const invalidAddress =
      chainFixture.defaultContractAddress.slice(0, 41) + "G";

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/metadata/${chainFixture.chainId}/${invalidAddress}`)
      .send({
        sources: {
          [Object.keys(chainFixture.defaultContractMetadataObject.sources)[0]]:
            chainFixture.defaultContractSource.toString(),
        },
        metadata: chainFixture.defaultContractMetadataObject,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

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
        `/v2/verify/metadata/${unknownChainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        sources: {
          [Object.keys(chainFixture.defaultContractMetadataObject.sources)[0]]:
            chainFixture.defaultContractSource.toString(),
        },
        metadata: chainFixture.defaultContractMetadataObject,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(404);
    chai.expect(verifyRes.body.customCode).to.equal("unsupported_chain");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });
});
