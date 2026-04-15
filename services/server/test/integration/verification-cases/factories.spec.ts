import chai from "chai";
import chaiHttp from "chai-http";
import path from "path";
import fs from "fs";
import {
  deployFromAbiAndBytecode,
  callContractMethodWithTx,
  hookIntoVerificationWorkerRun,
} from "../../helpers/helpers";
import { LocalChainFixture } from "../../helpers/LocalChainFixture";
import { ServerFixture } from "../../helpers/ServerFixture";
import { assertJobVerification } from "../../helpers/assertions";
import sinon from "sinon";

chai.use(chaiHttp);

describe("Factory-deployed contracts", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  afterEach(() => {
    sandbox.restore();
  });

  it("should verify a factory-deployed contract with immutables", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const factoryArtifact = (
      await import("../../testcontracts/FactoryImmutable/Factory.json")
    ).default;
    const factoryAddress = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      factoryArtifact.abi,
      factoryArtifact.bytecode,
    );

    // Deploy child by calling deploy(uint)
    const deployValue = 12345;
    const txReceipt = await callContractMethodWithTx(
      chainFixture.localSigner,
      factoryArtifact.abi,
      factoryAddress,
      "deploy",
      [deployValue],
    );
    if (!txReceipt) {
      chai.assert.fail("Didn't get a txReceipt from factory contract call");
    }
    // @ts-ignore
    const childAddress = txReceipt.logs[0].args[0] as string;

    const childMetadata = (
      await import("../../testcontracts/FactoryImmutable/Child_metadata.json")
    ).default;
    const sourceContent = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "testcontracts",
        "FactoryImmutable",
        "FactoryTest.sol",
      ),
      "utf8",
    );

    const sourceName = Object.keys(childMetadata.sources)[0];
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/metadata/${chainFixture.chainId}/${childAddress}`)
      .send({
        sources: { [sourceName]: sourceContent },
        metadata: childMetadata,
      });

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      chainFixture.chainId,
      childAddress,
      "exact_match",
    );
  });

  it("should verify a factory-deployed contract with msg.sender immutable and no constructor arguments", async () => {
    const { resolveWorkers } = makeWorkersWait();

    const factoryArtifact = (
      await import("../../testcontracts/FactoryImmutableWithoutConstrArg/Factory3.json")
    ).default;
    const factoryAddress = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      factoryArtifact.abi,
      factoryArtifact.bytecode,
    );

    // Deploy child by calling createChild()
    const txReceipt = await callContractMethodWithTx(
      chainFixture.localSigner,
      factoryArtifact.abi,
      factoryAddress,
      "createChild",
      [],
    );
    if (!txReceipt) {
      chai.assert.fail("Didn't get a txReceipt from factory contract call");
    }
    // @ts-ignore
    const childAddress = txReceipt.logs[0].args[0] as string;

    const childMetadata = (
      await import("../../testcontracts/FactoryImmutableWithoutConstrArg/Child3_metadata.json")
    ).default;
    const sourceContent = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "testcontracts",
        "FactoryImmutableWithoutConstrArg",
        "FactoryTest3.sol",
      ),
      "utf8",
    );

    const sourceName = Object.keys(childMetadata.sources)[0];
    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/metadata/${chainFixture.chainId}/${childAddress}`)
      .send({
        sources: { [sourceName]: sourceContent },
        metadata: childMetadata,
      });

    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      chainFixture.chainId,
      childAddress,
      "exact_match",
    );
  });
});
