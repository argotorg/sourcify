import chai from "chai";
import chaiHttp from "chai-http";
import sinon from "sinon";
import { findSolarPlatform } from "@ethereum-sourcify/compilers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import {
  deployFromBytecodeForCreatorTxHash,
  hookIntoVerificationWorkerRun,
} from "../../../helpers/helpers";
import { assertJobVerification } from "../../../helpers/assertions";
import type { FoundryProject } from "../../../helpers/foundry";
import {
  createFoundryProject,
  downloadFoundry,
  FOUNDRY_SOLAR_VERSION,
  runForge,
} from "../../../helpers/foundry";

chai.use(chaiHttp);

describe("Verify contracts built with the Solar that Foundry bundles", function () {
  // The test downloads Foundry, the server downloads Solar
  this.timeout(10 * 60 * 1000);

  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  let foundryDir: string;
  let project: FoundryProject;

  before(async function () {
    // Sourcify hosts the Solar of Foundry only for Linux x64
    if (findSolarPlatform() !== "x86_64-unknown-linux-musl") {
      this.skip();
    }
    foundryDir = await downloadFoundry();
    project = await createFoundryProject(foundryDir);
  });

  afterEach(() => {
    sandbox.restore();
  });

  async function expectFoundrySolarCompilation(address: string) {
    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${address}?fields=compilation`,
      );
    chai.expect(res.status).to.equal(200);
    chai.expect(res.body.match).to.equal("exact_match");
    chai.expect(res.body.compilation).to.include({
      compiler: "solar",
      compilerVersion: FOUNDRY_SOLAR_VERSION,
    });
  }

  it("should verify with forge verify-contract --verifier sourcify", async () => {
    const { contractAddress } = await deployFromBytecodeForCreatorTxHash(
      chainFixture.localSigner,
      project.creationBytecode,
    );
    const { stdout, stderr } = await runForge(foundryDir, project.root, [
      "verify-contract",
      contractAddress,
      "src/Counter.sol:Counter",
      "--use",
      "solar",
      "--chain",
      chainFixture.chainId,
      "--verifier",
      "sourcify",
      "--verifier-url",
      `http://localhost:${serverFixture.server.port}/`,
      "--watch",
      // The first job also downloads Solar
      "--retries",
      "24",
      "--delay",
      "5",
    ]);
    // forge prints the result on stderr
    chai.expect(stdout + stderr).to.contain("Status: `exact_match`");
    await expectFoundrySolarCompilation(contractAddress);
  });

  it("should verify the build info of forge build through the API", async () => {
    chai
      .expect(project.buildInfo.solcLongVersion)
      .to.equal(FOUNDRY_SOLAR_VERSION);
    const { contractAddress, txHash } =
      await deployFromBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        project.creationBytecode,
      );
    const { resolveWorkers } = makeWorkersWait();

    const verifyRes = await chai
      .request(serverFixture.server.app)
      .post(`/v2/verify/${chainFixture.chainId}/${contractAddress}`)
      .send({
        stdJsonInput: project.buildInfo.input,
        compilerVersion: project.buildInfo.solcLongVersion,
        contractIdentifier: "src/Counter.sol:Counter",
        creationTransactionHash: txHash,
      });
    await assertJobVerification(
      serverFixture,
      verifyRes,
      resolveWorkers,
      chainFixture.chainId,
      contractAddress,
      "exact_match",
    );
    await expectFoundrySolarCompilation(contractAddress);
  });
});
