import chai from "chai";
import chaiHttp from "chai-http";
import {
  deployFromBytecodeForCreatorTxHash,
  hookIntoVerificationWorkerRun,
} from "../../../helpers/helpers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import path from "path";
import fs from "fs";
import { assertJobVerification } from "../../../helpers/assertions";
import sinon from "sinon";

chai.use(chaiHttp);

describe("POST /v2/verify/:chainId/:address - Fe contracts", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  afterEach(async () => {
    sandbox.restore();
  });

  it("should verify a single-file Fe contract", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const counterPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "fe",
      "counter",
    );
    const artifact = JSON.parse(
      fs.readFileSync(path.join(counterPath, "artifact.json"), "utf8"),
    );
    const counterSource = fs.readFileSync(
      path.join(counterPath, "lib.fe"),
      "utf8",
    );

    const { contractAddress, txHash } =
      await deployFromBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        artifact.creationBytecode,
      );

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/${chainFixture.chainId}/${contractAddress}`)
      .send({
        stdJsonInput: {
          language: "Fe",
          sources: {
            "src/lib.fe": { content: counterSource },
          },
        },
        compilerVersion: "26.0.0-alpha.10",
        contractIdentifier: "src/lib.fe:Counter",
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

  it("should verify a multi-file Fe ingot", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const multiFilePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "fe",
      "multi_file",
    );
    const artifact = JSON.parse(
      fs.readFileSync(path.join(multiFilePath, "artifact.json"), "utf8"),
    );
    const libFeSource = fs.readFileSync(
      path.join(multiFilePath, "src", "lib.fe"),
      "utf8",
    );
    const counterFeSource = fs.readFileSync(
      path.join(multiFilePath, "src", "counter.fe"),
      "utf8",
    );

    const { contractAddress, txHash } =
      await deployFromBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        artifact.creationBytecode,
      );

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/${chainFixture.chainId}/${contractAddress}`)
      .send({
        stdJsonInput: {
          language: "Fe",
          sources: {
            "src/lib.fe": { content: libFeSource },
            "src/counter.fe": { content: counterFeSource },
          },
        },
        compilerVersion: "26.0.0-alpha.10",
        contractIdentifier: "src/counter.fe:Counter",
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

  it("should store and return correct Fe-specific fields after verification", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const counterPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "fe",
      "counter",
    );
    const artifact = JSON.parse(
      fs.readFileSync(path.join(counterPath, "artifact.json"), "utf8"),
    );
    const counterSource = fs.readFileSync(
      path.join(counterPath, "lib.fe"),
      "utf8",
    );

    const { contractAddress, txHash } =
      await deployFromBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        artifact.creationBytecode,
      );

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/${chainFixture.chainId}/${contractAddress}`)
      .send({
        stdJsonInput: {
          language: "Fe",
          sources: {
            "src/lib.fe": { content: counterSource },
          },
        },
        compilerVersion: "26.0.0-alpha.10",
        contractIdentifier: "src/lib.fe:Counter",
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

    // 1. API lookup — validates storage→serialization→retrieval pipeline
    const lookupRes = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${contractAddress}?fields=compilation,abi,metadata,storageLayout,sources,creationBytecode,runtimeBytecode`,
      );

    chai.expect(lookupRes.status).to.equal(200);
    chai.expect(lookupRes.body.match).to.equal("match");
    chai.expect(lookupRes.body.runtimeMatch).to.equal("match");
    chai.expect(lookupRes.body.creationMatch).to.equal("match");
    chai.expect(lookupRes.body.abi).to.be.null;
    chai.expect(lookupRes.body.metadata).to.be.null;
    chai.expect(lookupRes.body.storageLayout).to.be.null;
    chai.expect(lookupRes.body.compilation).to.deep.equal({
      language: "Fe",
      compiler: "fe",
      compilerVersion: "26.0.0-alpha.10",
      compilerSettings: {},
      name: "Counter",
      fullyQualifiedName: "src/lib.fe:Counter",
    });
    chai.expect(lookupRes.body.sources).to.deep.equal({
      "src/lib.fe": { content: counterSource },
    });
    // Fe emits no source maps, no link references, no immutables, no CBOR
    chai.expect(lookupRes.body.creationBytecode.cborAuxdata).to.deep.equal({});
    chai.expect(lookupRes.body.runtimeBytecode.cborAuxdata).to.deep.equal({});
    chai.expect(lookupRes.body.runtimeBytecode.sourceMap).to.be.null;
    chai.expect(lookupRes.body.runtimeBytecode.linkReferences).to.be.null;
    chai.expect(lookupRes.body.runtimeBytecode.immutableReferences).to.be.null;

    // 2. Direct DB query — validates what's actually stored in compiled_contracts
    const addressBuffer = Buffer.from(contractAddress.substring(2), "hex");
    const dbRes = await serverFixture.sourcifyDatabase!.query(
      `SELECT cc.compiler, cc.language, cc.name, cc.fully_qualified_name,
              cc.compiler_settings, cc.compilation_artifacts,
              cc.creation_code_artifacts, cc.runtime_code_artifacts
       FROM compiled_contracts cc
       JOIN verified_contracts vc ON vc.compilation_id = cc.id
       JOIN contract_deployments cd ON cd.id = vc.deployment_id
       WHERE cd.address = $1`,
      [addressBuffer],
    );
    const row = dbRes.rows[0];
    chai.expect(row.language).to.equal("fe");
    chai.expect(row.compiler).to.equal("fe");
    chai.expect(row.name).to.equal("Counter");
    chai.expect(row.fully_qualified_name).to.equal("src/lib.fe:Counter");
    chai.expect(row.compiler_settings).to.deep.equal({});
    // compilation_artifacts: all Solidity/Vyper-specific fields are null
    chai.expect(row.compilation_artifacts.abi).to.be.null;
    chai.expect(row.compilation_artifacts.userdoc).to.be.null;
    chai.expect(row.compilation_artifacts.devdoc).to.be.null;
    chai.expect(row.compilation_artifacts.storageLayout).to.be.null;
    chai.expect(row.compilation_artifacts.transientStorageLayout).to.be.null;
    chai.expect(row.compilation_artifacts.sources).to.be.null;
    // creation_code_artifacts: no source map, no link references, empty CBOR
    chai.expect(row.creation_code_artifacts.sourceMap).to.be.null;
    chai.expect(row.creation_code_artifacts.linkReferences).to.be.null;
    chai.expect(row.creation_code_artifacts.cborAuxdata).to.deep.equal({});
    // runtime_code_artifacts: no source map, no link references, no immutables, empty CBOR
    chai.expect(row.runtime_code_artifacts.sourceMap).to.be.null;
    chai.expect(row.runtime_code_artifacts.linkReferences).to.be.null;
    chai.expect(row.runtime_code_artifacts.immutableReferences).to.be.null;
    chai.expect(row.runtime_code_artifacts.cborAuxdata).to.deep.equal({});
  });
});
