import chai from "chai";
import chaiHttp from "chai-http";
import {
  deployFromAbiAndBytecodeForCreatorTxHash,
  hookIntoVerificationWorkerRun,
} from "../../helpers/helpers";
import { LocalChainFixture } from "../../helpers/LocalChainFixture";
import { ServerFixture } from "../../helpers/ServerFixture";
import path from "path";
import fs from "fs";
import { assertJobVerification } from "../../helpers/assertions";
import sinon from "sinon";
import {
  testAlreadyBeingVerified,
  testAlreadyVerified,
} from "../../helpers/common-tests";

chai.use(chaiHttp);

describe("POST /verify/:chainId/:address", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  afterEach(async () => {
    sandbox.restore();
  });

  it("should verify a contract with Solidity standard input JSON", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        stdJsonInput: chainFixture.defaultContractJsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
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

  it("should verify a Vyper contract", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const vyperContractPath = path.join(
      __dirname,
      "..",
      "..",
      "sources",
      "vyper",
      "testcontract",
    );
    const vyperArtifactPath = path.join(vyperContractPath, "artifact.json");
    const vyperArtifact = JSON.parse(
      fs.readFileSync(vyperArtifactPath, "utf8"),
    );
    const vyperSourceFileName = "test.vy";
    const vyperSourcePath = path.join(vyperContractPath, vyperSourceFileName);
    const vyperSource = fs.readFileSync(vyperSourcePath, "utf8");

    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        vyperArtifact.abi,
        vyperArtifact.bytecode,
      );

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/verify/${chainFixture.chainId}/${contractAddress}`)
      .send({
        language: "Vyper",
        stdJsonInput: {
          language: "Vyper",
          sources: {
            [vyperSourceFileName]: {
              content: vyperSource,
            },
          },
          settings: {
            evmVersion: "istanbul",
            outputSelection: {
              "*": ["evm.bytecode"],
            },
          },
        },
        compilerVersion: "0.3.10+commit.91361694",
        contractIdentifier: `${vyperSourceFileName}:${vyperSourceFileName.split(".")[0]}`,
        creationTransactionHash: txHash,
      });

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      chainFixture.chainId,
      contractAddress,
      "match",
    );
  });

  it("should fetch the creation transaction hash if not provided", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        stdJsonInput: chainFixture.defaultContractJsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
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

  it("should store a job error if the compiler returns an error", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const sourcePath = Object.keys(
      chainFixture.defaultContractMetadataObject.settings.compilationTarget,
    )[0];
    const jsonInput = JSON.parse(
      JSON.stringify(chainFixture.defaultContractJsonInput),
    );
    // Introduce a syntax error in the source code
    jsonInput.sources[sourcePath].content = jsonInput.sources[
      sourcePath
    ].content.replace("contract", "contrat");

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        stdJsonInput: jsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(202);

    await resolveWorkers();

    const jobRes = await chai
      .request(serverFixture.server.app)
      .get(`/verify/${verifyRes.body.verificationId}`);

    chai.expect(jobRes.status).to.equal(200);
    chai.expect(jobRes.body).to.include({
      isJobCompleted: true,
    });
    chai.expect(jobRes.body.error).to.exist;
    chai.expect(jobRes.body.error.customCode).to.equal("compiler_error");
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
      `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      {
        stdJsonInput: chainFixture.defaultContractJsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      },
    );
  });

  it("should return a 409 if the contract is already verified", async () => {
    await testAlreadyVerified(
      serverFixture,
      makeWorkersWait,
      `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      {
        stdJsonInput: chainFixture.defaultContractJsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      },
      chainFixture.chainId,
      chainFixture.defaultContractAddress,
    );
  });

  it("should return a 400 if the standard json input misses the language", async () => {
    const jsonInput = JSON.parse(
      JSON.stringify(chainFixture.defaultContractJsonInput),
    );
    delete jsonInput.language;

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        stdJsonInput: jsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 400 if the standard json input misses the sources field", async () => {
    const jsonInput = JSON.parse(
      JSON.stringify(chainFixture.defaultContractJsonInput),
    );
    delete jsonInput.sources;

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        stdJsonInput: jsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 400 if the standard json input misses the content field for any source", async () => {
    const sourcePath = Object.keys(
      chainFixture.defaultContractMetadataObject.settings.compilationTarget,
    )[0];
    const jsonInput = JSON.parse(
      JSON.stringify(chainFixture.defaultContractJsonInput),
    );
    delete jsonInput.sources[sourcePath].content;

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        stdJsonInput: jsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should return 400 when contract identifier is missing", async () => {
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        stdJsonInput: chainFixture.defaultContractJsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should return 400 when compiler version is missing", async () => {
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        stdJsonInput: chainFixture.defaultContractJsonInput,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should return 400 when standard JSON input is missing", async () => {
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_parameter");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should return a 404 when the chain is not found", async function () {
    const unknownChainId = chainFixture.chainId;
    const chainMap = serverFixture.server.chains;
    sandbox.stub(chainMap, unknownChainId).value(undefined);

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/verify/${unknownChainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        stdJsonInput: chainFixture.defaultContractJsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

    chai.expect(verifyRes.status).to.equal(404);
    chai.expect(verifyRes.body.customCode).to.equal("unsupported_chain");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });
});
