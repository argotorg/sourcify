import chai from "chai";
import chaiHttp from "chai-http";
import {
  deployFromAbiAndBytecodeForCreatorTxHash,
  hookIntoVerificationWorkerRun,
} from "../../../helpers/helpers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import path from "path";
import fs from "fs";
import { assertJobVerification } from "../../../helpers/assertions";
import sinon from "sinon";
import {
  testAlreadyBeingVerified,
  testAlreadyVerified,
} from "../../../helpers/common-tests";

chai.use(chaiHttp);

describe("POST /v2/verify/:chainId/:address", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  afterEach(async () => {
    sandbox.restore();
  });

  it("should return an invalid_json error if the body JSON is invalid", async () => {
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .set("Content-Type", "application/json")
      .send("{ invalid-json }");

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("invalid_json");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  it("should verify a contract with Solidity standard input JSON", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
      .post(`/v2/verify/${chainFixture.chainId}/${contractAddress}`)
      .send({
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
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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

  it("should store a job error if the Solidity compiler returns an error", async () => {
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
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
      .get(`/v2/verify/${verifyRes.body.verificationId}`);

    chai.expect(jobRes.status).to.equal(200);
    chai.expect(jobRes.body).to.include({
      isJobCompleted: true,
    });
    chai.expect(jobRes.body.error).to.exist;
    chai.expect(jobRes.body.error.customCode).to.equal("compiler_error");
    chai
      .expect(jobRes.body.error.errorData.compilerErrors[0].formattedMessage)
      .to.equal(
        "ParserError: Expected ';' but got '{'\n --> project:/contracts/Storage.sol:9:17:\n  |\n9 | contrat Storage {\n  |                 ^\n\n",
      );
    chai.expect(jobRes.body.contract).to.deep.equal({
      match: null,
      creationMatch: null,
      runtimeMatch: null,
      chainId: chainFixture.chainId,
      address: chainFixture.defaultContractAddress,
    });
  });

  it("should store a job error if the Vyper compiler returns an error", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const vyperContractPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "vyper",
      "testcontract3_fail",
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
      .post(`/v2/verify/${chainFixture.chainId}/${contractAddress}`)
      .send({
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
    chai.expect(jobRes.body.error.customCode).to.equal("compiler_error");
    chai
      .expect(jobRes.body.error.errorData.compilerErrors[0].formattedMessage)
      .to.equal(
        'invalid syntax (<unknown>, line 11)\n  line 11:22 \n       10 def helloWorld() -> String[24]:\n  ---> 11     error_in_the_code!\n  ------------------------------^\n       12     return "Hello Vyper!"\n',
      );
    chai.expect(jobRes.body.contract).to.deep.equal({
      match: null,
      creationMatch: null,
      runtimeMatch: null,
      chainId: chainFixture.chainId,
      address: contractAddress,
    });
  });

  it("should return a 429 if the contract is being verified at the moment already", async () => {
    await testAlreadyBeingVerified(
      serverFixture,
      makeWorkersWait,
      `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
      `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
        `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
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
    const unknownChainId = "5";
    const chainMap = serverFixture.server.chainRepository.sourcifyChainMap;
    sandbox.stub(chainMap, unknownChainId).value(undefined);

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/${unknownChainId}/${chainFixture.defaultContractAddress}`,
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

  it("should fail matching with creation tx if the provided creationTransactionHash does not match the contract address", async () => {
    // Deploy contract A
    const deploymentA = await deployFromAbiAndBytecodeForCreatorTxHash(
      chainFixture.localSigner,
      chainFixture.defaultContractArtifact.abi,
      chainFixture.defaultContractArtifact.bytecode,
    );

    // Deploy contract B
    const deploymentB = await deployFromAbiAndBytecodeForCreatorTxHash(
      chainFixture.localSigner,
      chainFixture.defaultContractArtifact.abi,
      chainFixture.defaultContractArtifact.bytecode,
    );

    const { resolveWorkers } = makeWorkersWait();

    // Try to verify contract A, but provide B's creatorTxHash
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/${chainFixture.chainId}/${deploymentA.contractAddress}`)
      .send({
        stdJsonInput: chainFixture.defaultContractJsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        contractIdentifier: Object.entries(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0].join(":"),
        creationTransactionHash: deploymentB.txHash,
      });

    await resolveWorkers();

    // Fetch the job result
    const jobRes = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${verifyRes.body.verificationId}`);

    chai.expect(jobRes.status).to.be.oneOf([200]);
    chai.expect(jobRes.body).to.include({
      isJobCompleted: true,
    });
    chai.expect(jobRes.body.error).to.not.exist;
    chai.expect(jobRes.body.contract.creationMatch).to.be.null;
    chai.expect(jobRes.body.contract.runtimeMatch).to.equal("exact_match");
  });
});
