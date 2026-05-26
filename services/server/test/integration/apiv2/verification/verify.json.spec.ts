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
      false,
    );
  });

  it("should verify a Yul contract", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const yulContractPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "yul",
      "cas-forwarder",
    );
    const yulArtifact = JSON.parse(
      fs.readFileSync(path.join(yulContractPath, "artifact.json"), "utf8"),
    );
    const jsonInput = JSON.parse(
      fs.readFileSync(path.join(yulContractPath, "jsonInput.json"), "utf8"),
    );
    const sourceFileName = "cas-forwarder.yul";
    const contractIdentifier = `${sourceFileName}:cas-forwarder`;

    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        yulArtifact.abi,
        yulArtifact.bytecode,
      );

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/${chainFixture.chainId}/${contractAddress}`)
      .send({
        stdJsonInput: jsonInput,
        compilerVersion: "0.8.26+commit.8a97fa7a",
        contractIdentifier,
        creationTransactionHash: txHash,
      });

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      chainFixture.chainId,
      contractAddress,
      "match",
      false,
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

  it("should return a 400 when the chain is not found", async function () {
    const unknownChainId = "1337";
    const chainMap = serverFixture.sourcifyChainsMap;
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

    chai.expect(verifyRes.status).to.equal(400);
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

    // The deployer and blockNumber stored in contract_deployments must NOT
    // come from the wrong transaction. Since the creationTransactionHash
    // validation failed, these fields should be null.
    const deploymentResult = await serverFixture.sourcifyDatabase.query(
      `SELECT encode(deployer, 'hex') as deployer, block_number, encode(transaction_hash, 'hex') as transaction_hash
       FROM contract_deployments`,
    );
    chai.expect(deploymentResult?.rows).to.have.length(1);
    chai.expect(deploymentResult?.rows[0].transaction_hash).to.be.null;
    chai.expect(deploymentResult?.rows[0].deployer).to.be.null;
    chai.expect(deploymentResult?.rows[0].block_number).to.be.null;
  });

  describe("match upgrades", function () {
    it("should upgrade creation match from null to exact_match when re-verified with correct creationTransactionHash", async () => {
      const fakeTxHash =
        "0x0000000000000000000000000000000000000000000000000000000000000001";

      const { resolveWorkers, runTaskStub } = makeWorkersWait();

      // First verification with wrong creationTransactionHash - creation match will be null
      const verifyRes1 = await chai
        .request(serverFixture.server.app)
        .post(
          `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
        )
        .send({
          stdJsonInput: chainFixture.defaultContractJsonInput,
          compilerVersion:
            chainFixture.defaultContractMetadataObject.compiler.version,
          contractIdentifier: Object.entries(
            chainFixture.defaultContractMetadataObject.settings
              .compilationTarget,
          )[0].join(":"),
          creationTransactionHash: fakeTxHash,
        });

      chai.expect(verifyRes1.status).to.equal(202);
      await resolveWorkers();

      // Check first verification result
      const jobRes1 = await chai
        .request(serverFixture.server.app)
        .get(`/v2/verify/${verifyRes1.body.verificationId}`);

      chai.expect(jobRes1.status).to.equal(200);
      chai.expect(jobRes1.body.isJobCompleted).to.be.true;
      chai.expect(jobRes1.body.contract.runtimeMatch).to.equal("exact_match");
      chai.expect(jobRes1.body.contract.creationMatch).to.be.null;

      // Check database: creation_match should be false
      const verifiedContractsResult1 =
        await serverFixture.sourcifyDatabase.query(
          "SELECT creation_match FROM verified_contracts",
        );
      chai.expect(verifiedContractsResult1?.rows).to.have.length(1);
      chai.expect(verifiedContractsResult1?.rows[0].creation_match).to.be.false;

      // Check contract_deployments: should have no transaction_hash
      const contractDeployment1 = await serverFixture.sourcifyDatabase.query(
        "SELECT transaction_hash, block_number, transaction_index FROM contract_deployments",
      );
      chai.expect(contractDeployment1?.rows).to.have.length(1);
      chai.expect(contractDeployment1?.rows[0].transaction_hash).to.be.null;
      chai.expect(contractDeployment1?.rows[0].block_number).to.be.null;
      chai.expect(contractDeployment1?.rows[0].transaction_index).to.be.null;

      // Re-verify with correct creationTransactionHash to upgrade
      runTaskStub.restore();
      const { resolveWorkers: resolveWorkers2 } = makeWorkersWait();

      const verifyRes2 = await chai
        .request(serverFixture.server.app)
        .post(
          `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
        )
        .send({
          stdJsonInput: chainFixture.defaultContractJsonInput,
          compilerVersion:
            chainFixture.defaultContractMetadataObject.compiler.version,
          contractIdentifier: Object.entries(
            chainFixture.defaultContractMetadataObject.settings
              .compilationTarget,
          )[0].join(":"),
          creationTransactionHash: chainFixture.defaultContractCreatorTx,
        });

      chai.expect(verifyRes2.status).to.equal(202);
      await resolveWorkers2();

      const jobRes2 = await chai
        .request(serverFixture.server.app)
        .get(`/v2/verify/${verifyRes2.body.verificationId}`);

      chai.expect(jobRes2.status).to.equal(200);
      chai.expect(jobRes2.body.isJobCompleted).to.be.true;
      chai.expect(jobRes2.body.contract.runtimeMatch).to.equal("exact_match");
      chai.expect(jobRes2.body.contract.creationMatch).to.equal("exact_match");

      // Check database: should have two verified_contracts entries
      const verifiedContractsResult2 =
        await serverFixture.sourcifyDatabase.query(
          "SELECT creation_match FROM verified_contracts ORDER BY id DESC",
        );
      chai.expect(verifiedContractsResult2?.rows).to.have.length(2);
      chai.expect(verifiedContractsResult2?.rows[0].creation_match).to.be.true;
      chai.expect(verifiedContractsResult2?.rows[1].creation_match).to.be.false;

      // Check contract_deployments: new entry should have correct transaction info
      const contractDeployment2 = await serverFixture.sourcifyDatabase.query(
        "SELECT encode(transaction_hash, 'hex') as transaction_hash, block_number, transaction_index, contract_id FROM contract_deployments ORDER BY created_at DESC LIMIT 1",
      );
      chai
        .expect(contractDeployment2?.rows[0].transaction_hash)
        .to.equal(chainFixture.defaultContractCreatorTx.substring(2));
    });

    async function testPartialUpgrade(matchType: "creation" | "runtime") {
      // Build a modified standard JSON input that produces a partial match
      const modifiedJsonInput = JSON.parse(
        JSON.stringify(chainFixture.defaultContractJsonInput),
      );
      modifiedJsonInput.sources = {
        "contracts/StorageModified.sol": {
          content: chainFixture.defaultContractModifiedSource.toString(),
        },
      };

      // Step 1: Create a partial match with modified sources
      const { resolveWorkers: resolveWorkers1, runTaskStub: runTaskStub1 } =
        makeWorkersWait();

      const verifyRes1 = await chai
        .request(serverFixture.server.app)
        .post(
          `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
        )
        .send({
          stdJsonInput: modifiedJsonInput,
          compilerVersion:
            chainFixture.defaultContractMetadataObject.compiler.version,
          contractIdentifier: "contracts/StorageModified.sol:StorageModified",
          creationTransactionHash: chainFixture.defaultContractCreatorTx,
        });

      chai.expect(verifyRes1.status).to.equal(202);
      await resolveWorkers1();

      // Verify partial match
      const jobRes1 = await chai
        .request(serverFixture.server.app)
        .get(`/v2/verify/${verifyRes1.body.verificationId}`);

      chai.expect(jobRes1.body.isJobCompleted).to.be.true;
      chai.expect(jobRes1.body.error).to.be.undefined;
      chai.expect(jobRes1.body.contract.runtimeMatch).to.equal("match");
      chai.expect(jobRes1.body.contract.creationMatch).to.equal("match");

      // Confirm DB state
      const contractMatchesPartial = await serverFixture.sourcifyDatabase.query(
        "SELECT runtime_match, creation_match FROM sourcify_matches",
      );
      chai
        .expect(contractMatchesPartial.rows[0].runtime_match)
        .to.equal("partial");
      chai
        .expect(contractMatchesPartial.rows[0].creation_match)
        .to.equal("partial");

      // Save contract_id for later comparison
      const contractDeploymentAfterPartial =
        await serverFixture.sourcifyDatabase.query(
          "SELECT contract_id FROM contract_deployments",
        );
      chai.expect(contractDeploymentAfterPartial?.rows).to.have.length(1);
      const contractIdAfterPartial =
        contractDeploymentAfterPartial?.rows[0].contract_id;

      // Step 2: Force one match to "perfect" in DB and move files on filesystem
      await serverFixture.sourcifyDatabase.query(
        `UPDATE sourcify_matches SET ${matchType}_match='perfect' WHERE 1=1`,
      );

      // Step 3: Re-verify with original sources to upgrade the remaining partial match
      runTaskStub1.restore();
      const { resolveWorkers: resolveWorkers2 } = makeWorkersWait();

      const verifyRes2 = await chai
        .request(serverFixture.server.app)
        .post(
          `/v2/verify/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
        )
        .send({
          stdJsonInput: chainFixture.defaultContractJsonInput,
          compilerVersion:
            chainFixture.defaultContractMetadataObject.compiler.version,
          contractIdentifier: Object.entries(
            chainFixture.defaultContractMetadataObject.settings
              .compilationTarget,
          )[0].join(":"),
          creationTransactionHash: chainFixture.defaultContractCreatorTx,
        });

      await assertJobVerification(
        serverFixture,
        verifyRes2,
        resolveWorkers2,
        chainFixture.chainId,
        chainFixture.defaultContractAddress,
        "exact_match",
      );

      // Verify both matches are now "perfect" in DB
      const contractMatchesPerfect = await serverFixture.sourcifyDatabase.query(
        "SELECT runtime_match, creation_match FROM sourcify_matches",
      );
      chai
        .expect(contractMatchesPerfect.rows[0].runtime_match)
        .to.equal("perfect");
      chai
        .expect(contractMatchesPerfect.rows[0].creation_match)
        .to.equal("perfect");

      // contract_id should not have changed (same deployment, just upgraded match)
      const contractDeploymentAfterUpgrade =
        await serverFixture.sourcifyDatabase.query(
          "SELECT contract_id FROM contract_deployments",
        );
      chai.expect(contractDeploymentAfterUpgrade?.rows).to.have.length(1);
      chai
        .expect(contractDeploymentAfterUpgrade?.rows[0].contract_id)
        .to.equal(contractIdAfterPartial);

      // Should have two compiled_contracts_sources entries (partial + perfect)
      const sourcesResult = await serverFixture.sourcifyDatabase.query(
        "SELECT encode(source_hash, 'hex') as source_hash FROM compiled_contracts_sources",
      );
      chai.expect(sourcesResult?.rows).to.have.length(2);
    }

    it("should upgrade creation match from match to exact_match even if runtime match is already exact_match", async () => {
      await testPartialUpgrade("runtime");
    });

    it("should upgrade runtime match from match to exact_match even if creation match is already exact_match", async () => {
      await testPartialUpgrade("creation");
    });
  });
});
