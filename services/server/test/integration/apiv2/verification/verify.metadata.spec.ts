import chai from "chai";
import chaiHttp from "chai-http";
import {
  deployFromAbiAndBytecode,
  deployFromAbiAndBytecodeForCreatorTxHash,
  hookIntoVerificationWorkerRun,
} from "../../../helpers/helpers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import {
  assertJobVerification,
  assertTransformations,
} from "../../../helpers/assertions";
import sinon from "sinon";
import {
  testAlreadyBeingVerified,
  testAlreadyVerified,
} from "../../../helpers/common-tests";
import path from "path";
import fs from "fs";
import {
  CallProtectionTransformation,
  LibraryTransformation,
} from "@ethereum-sourcify/lib-sourcify";

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

  it("should fetch a missing source file via IPFS", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(
        `/v2/verify/metadata/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      )
      .send({
        sources: {},
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

  it("should return a 400 when the chain is not found", async function () {
    const unknownChainId = "1337";
    const chainMap = serverFixture.sourcifyChainsMap;
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

    chai.expect(verifyRes.status).to.equal(400);
    chai.expect(verifyRes.body.customCode).to.equal("unsupported_chain");
    chai.expect(verifyRes.body).to.have.property("errorId");
    chai.expect(verifyRes.body).to.have.property("message");
  });

  describe("solc v0.6.12 and v0.7.0 extra files in compilation causing metadata match but bytecode mismatch", function () {
    let contractAddress: string;
    let creationTxHash: string;

    before(async () => {
      const bytecodeMismatchArtifact = (
        await import("../../../sources/artifacts/extraFilesBytecodeMismatch.json")
      ).default;
      const deployment = await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        bytecodeMismatchArtifact.abi,
        bytecodeMismatchArtifact.bytecode,
      );
      contractAddress = deployment.contractAddress;
      creationTxHash = deployment.txHash;
    });

    it("should return extra_file_input_bug error when only metadata sources are provided", async () => {
      const { resolveWorkers } = makeWorkersWait();
      const hardhatOutput =
        await import("../../../sources/hardhat-output/extraFilesBytecodeMismatch-onlyMetadata.json");

      const sources = Object.entries(
        hardhatOutput.input.sources as Record<string, { content: string }>,
      ).reduce(
        (acc, [path, source]) => {
          acc[path] = source.content;
          return acc;
        },
        {} as Record<string, string>,
      );
      const metadata = JSON.parse(
        hardhatOutput.output.contracts[
          "contracts/protocol/lendingpool/LendingPool.sol"
        ].LendingPool.metadata,
      );

      const verifyRes = await chai
        .request(serverFixture.server.app)
        .post(`/v2/verify/metadata/${chainFixture.chainId}/${contractAddress}`)
        .send({
          sources,
          metadata,
          creationTransactionHash: creationTxHash,
        });

      chai.expect(verifyRes.status).to.equal(202);

      await resolveWorkers();

      const jobRes = await chai
        .request(serverFixture.server.app)
        .get(`/v2/verify/${verifyRes.body.verificationId}`);

      chai.expect(jobRes.status).to.equal(200);
      chai.expect(jobRes.body.isJobCompleted).to.be.true;
      chai.expect(jobRes.body.error).to.exist;
      chai
        .expect(jobRes.body.error.customCode)
        .to.equal("extra_file_input_bug");
    });

    it("should verify with all input files when extra-file-input-bug is detected", async () => {
      const { resolveWorkers } = makeWorkersWait();
      const hardhatOutput =
        await import("../../../sources/hardhat-output/extraFilesBytecodeMismatch.json");

      const sources = Object.entries(
        hardhatOutput.input.sources as Record<string, { content: string }>,
      ).reduce(
        (acc, [path, source]) => {
          acc[path] = source.content;
          return acc;
        },
        {} as Record<string, string>,
      );
      const metadata = JSON.parse(
        hardhatOutput.output.contracts[
          "contracts/protocol/lendingpool/LendingPool.sol"
        ].LendingPool.metadata,
      );

      const verifyRes = await chai
        .request(serverFixture.server.app)
        .post(`/v2/verify/metadata/${chainFixture.chainId}/${contractAddress}`)
        .send({
          sources,
          metadata,
          creationTransactionHash: creationTxHash,
        });

      await assertJobVerification(
        serverFixture,
        verifyRes,
        resolveWorkers,
        chainFixture.chainId,
        contractAddress,
        "exact_match",
      );
    });
  });

  it("should store the correct/recompiled metadata even if wrong metadata input yields a match", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const artifact = (
      await import("../../../testcontracts/ensure-metadata-storage/EIP1967Proxy.json")
    ).default;
    const wrongMetadata = (
      await import("../../../testcontracts/ensure-metadata-storage/wrong-metadata.json")
    ).default;
    const correctMetadata = (
      await import("../../../testcontracts/ensure-metadata-storage/correct-metadata.json")
    ).default;

    const source1Content = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "testcontracts",
        "ensure-metadata-storage",
        "EIP1967Proxy.sol",
      ),
      "utf8",
    );
    const source2Content = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "testcontracts",
        "ensure-metadata-storage",
        "EIP1967Admin.sol",
      ),
      "utf8",
    );

    const contractAddress = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      correctMetadata.output.abi,
      artifact.bytecode,
      [
        "0x39f0bd56c1439a22ee90b4972c16b7868d161981",
        "0x000000000000000000000000000000000000dead",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ],
    );

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/metadata/${chainFixture.chainId}/${contractAddress}`)
      .send({
        sources: {
          "src/proxy/EIP1967Proxy.sol": source1Content,
          "src/proxy/EIP1967Admin.sol": source2Content,
        },
        metadata: wrongMetadata,
      });

    chai.expect(verifyRes.status).to.equal(202);
    await resolveWorkers();

    const jobRes = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${verifyRes.body.verificationId}`);

    chai.expect(jobRes.body.isJobCompleted).to.be.true;
    chai.expect(jobRes.body.error).to.be.undefined;
    chai.expect(jobRes.body.contract.runtimeMatch).to.equal("exact_match");

    // Fetch the stored contract and check that the correct metadata was stored
    const contractRes = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${contractAddress}?fields=metadata`,
      );

    chai.expect(contractRes.status).to.equal(200);
    chai.expect(contractRes.body.metadata).to.deep.equal(correctMetadata);
  });

  it("should verify a Solidity < 0.5.0 library contract with non-keccak library placeholders and call protection", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const artifact = (
      await import("../../../testcontracts/LibrariesPreSolidity050/artifact.json")
    ).default;
    const metadata = (
      await import("../../../testcontracts/LibrariesPreSolidity050/metadata.json")
    ).default;

    const address = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      artifact.abi,
      artifact.bytecode,
    );

    const sourceContent = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "testcontracts",
        "LibrariesPreSolidity050",
        "sources",
        "ClaimHolderLibrary.sol",
      ),
      "utf8",
    );

    const sourceName = Object.keys(metadata.sources)[0];
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/metadata/${chainFixture.chainId}/${address}`)
      .send({
        sources: { [sourceName]: sourceContent },
        metadata,
      });

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      chainFixture.chainId,
      address,
      "exact_match",
    );

    const libraryFQN = "ClaimHolderLibrary.sol:KeyHolderLibrary";
    const libraryAddress = "0xcafecafecafecafecafecafecafecafecafecafe";

    await assertTransformations(
      serverFixture.sourcifyDatabase,
      address,
      chainFixture.chainId,
      [
        CallProtectionTransformation(),
        LibraryTransformation(1341, libraryFQN),
        LibraryTransformation(3043, libraryFQN),
        LibraryTransformation(3262, libraryFQN),
      ],
      {
        libraries: {
          [libraryFQN]: libraryAddress,
        },
        callProtection: address.toLowerCase(),
      },
      [
        LibraryTransformation(1389, libraryFQN),
        LibraryTransformation(3091, libraryFQN),
        LibraryTransformation(3310, libraryFQN),
      ],
      {
        libraries: {
          [libraryFQN]: libraryAddress,
        },
      },
    );
  });
});
