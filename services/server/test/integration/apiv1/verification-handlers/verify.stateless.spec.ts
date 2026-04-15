import {
  assertValidationError,
  assertVerification,
} from "../../../helpers/assertions";
import chai from "chai";
import chaiHttp from "chai-http";
import { StatusCodes } from "http-status-codes";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import type { Done } from "mocha";
import type { Response } from "superagent";
import path from "path";
import fs from "fs";
import {
  waitSecs,
  deployFromAbiAndBytecodeForCreatorTxHash,
  deployFromAbiAndBytecode,
} from "../../../helpers/helpers";
import hardhatOutputJSON from "../../../sources/hardhat-output/output.json";
import sinon from "sinon";

chai.use(chaiHttp);

describe("/", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();

  const checkNonVerified = (path: string, done: Done) => {
    chai
      .request(serverFixture.server.app)
      .post(path)
      .field("chain", chainFixture.chainId)
      .field("address", chainFixture.defaultContractAddress)
      .end((err, res) => {
        chai.expect(err).to.be.null;
        chai.expect(res.body).to.haveOwnProperty("error");
        chai.expect(res.status).to.equal(StatusCodes.NOT_FOUND);
        done();
      });
  };

  it("should correctly inform for an address check of a non verified contract (at /)", (done) => {
    checkNonVerified("/", done);
  });

  it("should correctly inform for an address check of a non verified contract (at /verify)", (done) => {
    checkNonVerified("/verify", done);
  });

  it("should verify multipart upload", (done) => {
    chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .attach("files", chainFixture.defaultContractSource, "Storage.sol")
      .end(
        async (err, res) =>
          await assertVerification(
            serverFixture,
            err,
            res,
            done,
            chainFixture.defaultContractAddress,
            chainFixture.chainId,
            "perfect",
          ),
      );
  });

  it("should verify json upload with string properties", (done) => {
    chai
      .request(serverFixture.server.app)
      .post("/")
      .send({
        address: chainFixture.defaultContractAddress,
        chain: chainFixture.chainId,
        files: {
          "metadata.json": chainFixture.defaultContractMetadata.toString(),
          "Storage.sol": chainFixture.defaultContractSource.toString(),
        },
      })
      .end(
        async (err, res) =>
          await assertVerification(
            serverFixture,
            err,
            res,
            done,
            chainFixture.defaultContractAddress,
            chainFixture.chainId,
            "perfect",
          ),
      );
  });

  it("should verify json upload with Buffer properties", (done) => {
    chai
      .request(serverFixture.server.app)
      .post("/")
      .send({
        address: chainFixture.defaultContractAddress,
        chain: chainFixture.chainId,
        files: {
          "metadata.json": chainFixture.defaultContractMetadata,
          "Storage.sol": chainFixture.defaultContractSource,
        },
      })
      .end(
        async (err, res) =>
          await assertVerification(
            serverFixture,
            err,
            res,
            done,
            chainFixture.defaultContractAddress,
            chainFixture.chainId,
            "perfect",
          ),
      );
  });

  const assertMissingFile = (err: Error, res: Response) => {
    chai.expect(err).to.be.null;
    chai.expect(res.body).to.haveOwnProperty("error");
    const errorMessage = res.body.error.toLowerCase();
    chai.expect(res.status).to.equal(StatusCodes.BAD_REQUEST);
    chai.expect(errorMessage).to.include("missing");
    chai.expect(errorMessage).to.include("Storage".toLowerCase());
  };

  it("should return Bad Request Error for a source that is missing and unfetchable", (done) => {
    chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach(
        "files",
        Buffer.from(
          JSON.stringify(
            chainFixture.defaultContractMetadataWithModifiedIpfsHash,
          ),
        ),
        "metadata.json",
      )
      .end((err, res) => {
        assertMissingFile(err, res);
        done();
      });
  });

  // We cannot split this into multiple tests because there is a global beforeEach that resets the database
  it("Should skip verification for /verify, /verify/etherscan and /verify/solc-json if contract is already verified", async () => {
    // Spy on the verifyFromCompilation method
    const verifyFromCompilationSpy = sinon.spy(
      serverFixture.server.services.verification,
      "verifyFromCompilation",
    );

    // Perform the initial verification
    const initialResponse = await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .field("creatorTxHash", chainFixture.defaultContractCreatorTx)
      .attach("files", chainFixture.defaultContractSource);

    await assertVerification(
      serverFixture,
      null,
      initialResponse,
      null,
      chainFixture.defaultContractAddress,
      chainFixture.chainId,
      "perfect",
    );

    // Verify that verifyFromCompilation was called during the initial verification
    chai.expect(
      verifyFromCompilationSpy.calledOnce,
      "verifyFromCompilation should be called once during initial verification",
    ).to.be.true;

    // The first time the contract is verified, the storageTimestamp is not returned
    chai.expect(initialResponse.body.result[0].storageTimestamp).to.not.exist;

    // Reset the spy before calling the endpoint again
    verifyFromCompilationSpy.resetHistory();

    /**
     * Test /verify endpoint is not calling verifyFromCompilation again
     */
    chai.expect(
      verifyFromCompilationSpy.notCalled,
      "verifyFromCompilation should not be called for /verify",
    ).to.be.true;
    let res = await chai
      .request(serverFixture.server.app)
      .post("/verify")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .field("creatorTxHash", chainFixture.defaultContractCreatorTx)
      .attach("files", chainFixture.defaultContractSource);

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      chainFixture.defaultContractAddress,
      chainFixture.chainId,
      "perfect",
    );

    // Verify that verifyFromCompilation was NOT called
    chai.expect(
      verifyFromCompilationSpy.notCalled,
      "verifyFromCompilation should not be called for /verify",
    ).to.be.true;
    chai.expect(res.body.result[0].storageTimestamp).to.exist;

    /**
     * Test /verify/etherscan endpoint is not calling verifyFromCompilation again
     */
    res = await chai
      .request(serverFixture.server.app)
      .post("/verify/etherscan")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId);

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      chainFixture.defaultContractAddress,
      chainFixture.chainId,
      "perfect",
    );

    // Verify that verifyFromCompilation was NOT called
    chai.expect(
      verifyFromCompilationSpy.notCalled,
      "verifyFromCompilation should not be called for /verify/etherscan",
    ).to.be.true;
    chai.expect(res.body.result[0].storageTimestamp).to.exist;

    /**
     * Test /verify/solc-json endpoint is not calling verifyFromCompilation again
     */
    const solcJsonPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "testcontracts",
      "Storage",
      "StorageJsonInput.json",
    );
    const solcJsonBuffer = fs.readFileSync(solcJsonPath);

    res = await chai
      .request(serverFixture.server.app)
      .post("/verify/solc-json")
      .attach("files", solcJsonBuffer, "solc.json")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .field("compilerVersion", "0.8.4+commit.c7e474f2")
      .field("contractName", "Storage");

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      chainFixture.defaultContractAddress,
      chainFixture.chainId,
      "perfect",
    );

    // Verify that verifyFromCompilation was NOT called
    chai.expect(
      verifyFromCompilationSpy.notCalled,
      "verifyFromCompilation should not be called for /verify/solc-json",
    ).to.be.true;
    chai.expect(res.body.result[0].storageTimestamp).to.exist;

    // Restore the original verifyFromCompilation method
    verifyFromCompilationSpy.restore();
  });

  it("should return 'partial', then throw when another 'partial' match is received", async () => {
    const partialMetadata = (
      await import("../../../testcontracts/Storage/metadataModified.json")
    ).default;
    const partialMetadataBuffer = Buffer.from(JSON.stringify(partialMetadata));

    const partialSourcePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "testcontracts",
      "Storage",
      "StorageModified.sol",
    );
    const partialSourceBuffer = fs.readFileSync(partialSourcePath);

    const partialMetadataURL = `/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`;

    let res = await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", partialMetadataBuffer, "metadata.json")
      .attach("files", partialSourceBuffer);
    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      chainFixture.defaultContractAddress,
      chainFixture.chainId,
      "partial",
    );

    res = await chai.request(serverFixture.server.app).get(partialMetadataURL);
    chai.expect(res.body).to.deep.equal(partialMetadata);

    res = await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", partialMetadataBuffer, "metadata.json")
      .attach("files", partialSourceBuffer);

    chai.expect(res.status).to.equal(StatusCodes.CONFLICT);
    chai
      .expect(res.body.error)
      .to.equal(
        `The contract ${chainFixture.defaultContractAddress} on chainId ${chainFixture.chainId} is already partially verified. The provided new source code also yielded a partial match and will not be stored unless it's a full match`,
      );
  });

  it("should mark contracts without an embedded metadata hash as a 'partial' match", async () => {
    // Simple contract without bytecode at https://goerli.etherscan.io/address/0x093203902B71Cdb1dAA83153b3Df284CD1a2f88d
    const bytecode =
      "0x6080604052348015600f57600080fd5b50601680601d6000396000f3fe6080604052600080fdfea164736f6c6343000700000a";
    const metadataPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "metadata",
      "withoutMetadataHash.meta.object.json",
    );
    const metadataBuffer = fs.readFileSync(metadataPath);
    const metadata = JSON.parse(metadataBuffer.toString());
    const address = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      metadata.output.abi,
      bytecode,
    );

    const res = await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", address)
      .field("chain", chainFixture.chainId)
      .attach("files", metadataBuffer, "metadata.json");

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      address,
      chainFixture.chainId,
      "partial",
    );
  });

  it("should verify a contract with immutables and save immutable-references.json", async () => {
    const artifact = (
      await import("../../../testcontracts/WithImmutables/artifact.json")
    ).default;
    const { contractAddress } = await deployFromAbiAndBytecodeForCreatorTxHash(
      chainFixture.localSigner,
      artifact.abi,
      artifact.bytecode,
      [999],
    );

    const metadata = (
      await import(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "testcontracts",
          "WithImmutables",
          "metadata.json",
        )
      )
    ).default;
    const sourcePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "testcontracts",
      "WithImmutables",
      "sources",
      "WithImmutables.sol",
    );
    const sourceBuffer = fs.readFileSync(sourcePath);

    // Now pass the creatorTxHash
    const res = await chai
      .request(serverFixture.server.app)
      .post("/")
      .send({
        address: contractAddress,
        chain: chainFixture.chainId,
        files: {
          "metadata.json": JSON.stringify(metadata),
          "WithImmutables.sol": sourceBuffer.toString(),
        },
      });
    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      contractAddress,
      chainFixture.chainId,
    );
    const isExist = fs.existsSync(
      path.join(
        serverFixture.repositoryV1Path,
        "contracts",
        "full_match",
        chainFixture.chainId,
        contractAddress,
        "immutable-references.json",
      ),
    );
    chai.expect(isExist, "Immutable references not saved").to.be.true;
  });

  describe("solc standard input json", () => {
    it("should return validation error for adding standard input JSON without a compiler version", async () => {
      const address = await deployFromAbiAndBytecode(
        chainFixture.localSigner,
        chainFixture.defaultContractArtifact.abi, // Storage.sol
        chainFixture.defaultContractArtifact.bytecode,
      );
      const solcJsonPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "testcontracts",
        "Storage",
        "StorageJsonInput.json",
      );
      const solcJsonBuffer = fs.readFileSync(solcJsonPath);

      const res = await chai
        .request(serverFixture.server.app)
        .post("/verify/solc-json")
        .attach("files", solcJsonBuffer, "solc.json")
        .field("address", address)
        .field("chain", chainFixture.chainId)
        .field("contractName", "Storage");

      assertValidationError(null, res, "compilerVersion");
    });

    it("should return validation error for adding standard input JSON without a contract name", async () => {
      const address = await deployFromAbiAndBytecode(
        chainFixture.localSigner,
        chainFixture.defaultContractArtifact.abi, // Storage.sol
        chainFixture.defaultContractArtifact.bytecode,
      );
      const solcJsonPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "testcontracts",
        "Storage",
        "StorageJsonInput.json",
      );
      const solcJsonBuffer = fs.readFileSync(solcJsonPath);

      const res = await chai
        .request(serverFixture.server.app)
        .post("/verify/solc-json")
        .attach("files", solcJsonBuffer)
        .field("address", address)
        .field("chain", chainFixture.chainId)
        .field("compilerVersion", "0.8.4+commit.c7e474f2");

      assertValidationError(null, res, "contractName");
    });

    it("should verify a contract with Solidity standard input JSON", async () => {
      const address = await deployFromAbiAndBytecode(
        chainFixture.localSigner,
        chainFixture.defaultContractArtifact.abi, // Storage.sol
        chainFixture.defaultContractArtifact.bytecode,
      );
      const solcJsonPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "testcontracts",
        "Storage",
        "StorageJsonInput.json",
      );
      const solcJsonBuffer = fs.readFileSync(solcJsonPath);

      const res = await chai
        .request(serverFixture.server.app)
        .post("/verify/solc-json")
        .attach("files", solcJsonBuffer, "solc.json")
        .field("address", address)
        .field("chain", chainFixture.chainId)
        .field("compilerVersion", "0.8.4+commit.c7e474f2")
        .field("contractName", "Storage");

      await assertVerification(
        serverFixture,
        null,
        res,
        null,
        address,
        chainFixture.chainId,
      );
    });
  });

  describe("hardhat build-info file support", function () {
    let address: string;
    const mainContractIndex = 5;
    const MyToken =
      hardhatOutputJSON.output.contracts["contracts/MyToken.sol"].MyToken;
    const hardhatOutputBuffer = Buffer.from(JSON.stringify(hardhatOutputJSON));
    before(async function () {
      address = await deployFromAbiAndBytecode(
        chainFixture.localSigner,
        MyToken.abi,
        MyToken.evm.bytecode.object,
        ["Sourcify Hardhat Test", "TEST"],
      );
      console.log(`Contract deployed at ${address}`);
      await waitSecs(3);
    });

    it("should detect multiple contracts in the build-info file", (done) => {
      chai
        .request(serverFixture.server.app)
        .post("/")
        .field("chain", chainFixture.chainId)
        .field("address", address)
        .attach("files", hardhatOutputBuffer)
        .then((res) => {
          chai.expect(res.status).to.equal(StatusCodes.BAD_REQUEST);
          chai.expect(res.body.contractsToChoose.length).to.be.equal(6);
          chai
            .expect(res.body.error)
            .to.be.a("string")
            .and.satisfy((msg: string) => msg.startsWith("Detected "));
          done();
        });
    });

    it("should verify the chosen contract in the build-info file", (done) => {
      chai
        .request(serverFixture.server.app)
        .post("/")
        .field("chain", chainFixture.chainId)
        .field("address", address)
        .field("chosenContract", mainContractIndex)
        .attach("files", hardhatOutputBuffer)
        .end(async (err, res) => {
          await assertVerification(
            serverFixture,
            err,
            res,
            done,
            address,
            chainFixture.chainId,
            "perfect",
          );
        });
    });

    it("should store a contract in /contracts/full_match|partial_match/0xADDRESS despite the files paths in the metadata", async () => {
      const { contractAddress } =
        await deployFromAbiAndBytecodeForCreatorTxHash(
          chainFixture.localSigner,
          chainFixture.defaultContractArtifact.abi,
          chainFixture.defaultContractArtifact.bytecode,
          [],
        );
      const metadata = (
        await import("../../../testcontracts/Storage/metadata.upMultipleDirs.json")
      ).default;

      // Now pass the creatorTxHash
      const res = await chai
        .request(serverFixture.server.app)
        .post("/")
        .send({
          address: contractAddress,
          chain: chainFixture.chainId,
          files: {
            "metadata.json": JSON.stringify(metadata),
            "Storage.sol": chainFixture.defaultContractSource.toString(),
          },
        });
      await assertVerification(
        serverFixture,
        null,
        res,
        null,
        contractAddress,
        chainFixture.chainId,
        "partial",
      );
      const isExist = fs.existsSync(
        path.join(
          serverFixture.repositoryV1Path,
          "contracts",
          "partial_match",
          chainFixture.chainId,
          contractAddress,
          "sources",
          "Storage.sol",
        ),
      );
      chai.expect(isExist, "Files saved in the wrong directory").to.be.true;
    });
  });

  it("should verify a contract compiled with Solidity < 0.7.5 and libraries have been linked using compiler settings", async () => {
    const artifact = (
      await import("../../../testcontracts/LibrariesSolidity075/LibrariesSolidity075.json")
    ).default;
    const address = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      artifact.abi,
      artifact.bytecode,
    );

    const metadata = (
      await import("../../../testcontracts/LibrariesSolidity075/metadata.json")
    ).default;

    const file = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "testcontracts",
        "LibrariesSolidity075",
        "Example.sol",
      ),
    );

    const res = await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", address)
      .field("chain", chainFixture.chainId)
      .attach("files", Buffer.from(JSON.stringify(metadata)), "metadata.json")
      .attach("files", file, "Example.sol");

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      address,
      chainFixture.chainId,
      "perfect",
    );
  });
});
