import chai from "chai";
import chaiHttp from "chai-http";
import type { SolidityJsonInput } from "@ethereum-sourcify/compilers-types";
import {
  deployFromAbiAndBytecodeForCreatorTxHash,
  hookIntoVerificationWorkerRun,
} from "../../../../helpers/helpers";
import { LocalChainFixture } from "../../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../../helpers/ServerFixture";
import { assertJobVerification } from "../../../../helpers/assertions";
import sinon from "sinon";
import path from "path";
import fs from "fs";

chai.use(chaiHttp);

describe("POST /v2/verify/:chainId/:address - Compiler Version Tests", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();
  const makeWorkersWait = hookIntoVerificationWorkerRun(sandbox, serverFixture);

  // Test cases for minimum supported version boundary
  const COMPILER_VERSION_TESTS = [
    // 0.4.11 - minimum supported version (should pass)
    // !! IMPORTANT
    // THIS TEST FOR 0.4.11 gets stuck on certain environmetns because of the execution of solc-json get stuck
    {
      version: "0.4.11+commit.68ef5810",
      expectMatch: "match" as const,
      shouldPass: true,
    },
    // 0.4.10 - unsupported version (should fail)
    {
      version: "0.4.10+commit.f0d539ae",
      expectMatch: null,
      shouldPass: false,
    },
  ];

  // Universal contract that compiles across all Solidity versions
  const SIMPLE_STORAGE_SOURCE = fs.readFileSync(
    path.join(__dirname, "Storage.sol"),
    "utf8",
  );

  afterEach(async () => {
    sandbox.restore();
  });

  // Helper function to create standard JSON input for a given version
  function createSolcJsonInput(): SolidityJsonInput {
    return {
      language: "Solidity",
      sources: {
        "Storage.sol": {
          content: SIMPLE_STORAGE_SOURCE,
        },
      },
      settings: {},
    };
  }

  COMPILER_VERSION_TESTS.forEach(({ version, expectMatch, shouldPass }) => {
    const testTitle = shouldPass
      ? `should verify SimpleStorage compiled with Solidity ${version} (minimum supported)`
      : `should reject unsupported Solidity ${version} with compilation error`;

    it(testTitle, async function () {
      // Increase timeout for compilation and verification
      this.timeout(120000);

      const { resolveWorkers } = makeWorkersWait();

      const compilationArtifacts = JSON.parse(
        fs.readFileSync(path.join(__dirname, `${version}.json`), "utf8"),
      );

      try {
        // Deploy the compiled contract
        const { contractAddress, txHash } =
          await deployFromAbiAndBytecodeForCreatorTxHash(
            chainFixture.localSigner,
            compilationArtifacts.abi,
            compilationArtifacts.bytecode,
          );

        // Verify via API v2
        const verifyRes = await chai
          .request(serverFixture.server.app)
          .post(`/v2/verify/${chainFixture.chainId}/${contractAddress}`)
          .send({
            stdJsonInput: createSolcJsonInput(),
            compilerVersion: version,
            contractIdentifier: "Storage.sol:Storage",
            creationTransactionHash: txHash,
          });

        if (shouldPass) {
          // Assert successful verification with correct match type
          await assertJobVerification(
            serverFixture,
            verifyRes,
            resolveWorkers,
            chainFixture.chainId,
            contractAddress,
            expectMatch!,
          );
        } else {
          // Initial request should return 202 (accepted)
          chai.expect(verifyRes.status).to.equal(202);
          chai.expect(verifyRes.body).to.have.property("verificationId");

          await resolveWorkers();

          // Check job status to see it failed with unsupported_compiler_version
          const jobStatusRes = await chai
            .request(serverFixture.server.app)
            .get(`/v2/verify/${verifyRes.body.verificationId}`);

          chai.expect(jobStatusRes.status).to.equal(200);
          chai.expect(jobStatusRes.body.isJobCompleted).to.equal(true);
          chai.expect(jobStatusRes.body.error).to.exist;
          chai
            .expect(jobStatusRes.body.error.customCode)
            .to.equal("unsupported_compiler_version");
        }
      } catch (error) {
        console.error(`Test failed for Solidity version ${version}:`, error);
        throw error;
      }
    });
  });
});
