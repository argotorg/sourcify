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
        "0x" + artifact.creationBytecode,
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
        "0x" + artifact.creationBytecode,
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
});
