import chai from "chai";
import chaiHttp from "chai-http";
import { ServerFixture } from "../../helpers/ServerFixture";
import { VerificationJob } from "../../../src/server/types";
import { v4 as uuidv4 } from "uuid";
import { LocalChainFixture } from "../../helpers/LocalChainFixture";
import {
  getVerificationErrorMessage,
  MatchingErrorResponse,
} from "../../../src/server/apiv2/errors";
import { verifyContract } from "../../helpers/helpers";
import { JobErrorData } from "../../../src/server/services/utils/database-util";

chai.use(chaiHttp);

describe("GET /v2/verify/:verificationId", function () {
  const serverFixture = new ServerFixture();
  const chainFixture = new LocalChainFixture();

  async function createMockJob(
    isVerified: boolean = false,
    hasError: boolean = false,
  ): Promise<VerificationJob> {
    if (isVerified && hasError) {
      throw new Error(
        "Malformed test: isVerified and hasError cannot both be true",
      );
    }

    let verifiedAt: string | undefined;
    let matchId: string | undefined;
    let verifiedContractId: string | undefined;

    if (isVerified) {
      await verifyContract(serverFixture, chainFixture);

      // Get the verification details from the database
      const verificationResult = await serverFixture.sourcifyDatabase.query(
        `SELECT 
          sm.id as match_id,
          to_char(sm.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as verified_at,
          vc.id as verified_contract_id
        FROM verified_contracts vc
        JOIN sourcify_matches sm ON sm.verified_contract_id = vc.id
        JOIN contract_deployments cd ON cd.id = vc.deployment_id
        WHERE cd.address = $1 AND cd.chain_id = $2`,
        [
          Buffer.from(chainFixture.defaultContractAddress.substring(2), "hex"),
          chainFixture.chainId,
        ],
      );
      verifiedAt = verificationResult.rows[0].verified_at;
      matchId = verificationResult.rows[0].match_id;
      verifiedContractId = verificationResult.rows[0].verified_contract_id;
    }

    const isCompleted = isVerified || hasError;
    const verificationId = uuidv4();
    const startTime = new Date();
    const finishTime = isCompleted
      ? new Date(startTime.getTime() + 1000)
      : null;
    const compilationTime = isCompleted ? "1333" : null;
    const creationTransactionHash = chainFixture.defaultContractCreatorTx;
    const recompiledCreationCode =
      chainFixture.defaultContractArtifact.bytecode;
    const recompiledRuntimeCode =
      chainFixture.defaultContractArtifact.deployedBytecode;
    const onchainCreationCode = chainFixture.defaultContractArtifact.bytecode;
    const onchainRuntimeCode =
      chainFixture.defaultContractArtifact.deployedBytecode;
    let errorData: JobErrorData | null = null;
    let error: MatchingErrorResponse | null = null;
    if (hasError) {
      errorData = {
        missingSources: ["someSource.sol"],
      };
      error = {
        customCode: "missing_source",
        errorId: uuidv4(),
        message: getVerificationErrorMessage({
          code: "missing_source",
          missingSources: errorData.missingSources,
        }),
        creationTransactionHash,
        recompiledCreationCode,
        recompiledRuntimeCode,
        onchainCreationCode,
        onchainRuntimeCode,
        errorData,
      };
    }

    // Insert the job into the database
    await serverFixture.sourcifyDatabase.query(
      `INSERT INTO verification_jobs (
        id,
        started_at,
        completed_at,
        compilation_time,
        chain_id,
        contract_address,
        verified_contract_id,
        error_code,
        error_id,
        error_data,
        verification_endpoint
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        verificationId,
        startTime,
        finishTime,
        compilationTime,
        chainFixture.chainId,
        Buffer.from(chainFixture.defaultContractAddress.substring(2), "hex"),
        verifiedContractId,
        error?.customCode || null,
        error?.errorId || null,
        errorData,
        "/verify",
      ],
    );

    await serverFixture.sourcifyDatabase.query(
      `INSERT INTO verification_jobs_ephemeral (
        id,
        recompiled_creation_code,
        recompiled_runtime_code,
        onchain_creation_code,
        onchain_runtime_code,
        creation_transaction_hash
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        verificationId,
        Buffer.from(recompiledCreationCode.substring(2), "hex"),
        Buffer.from(recompiledRuntimeCode.substring(2), "hex"),
        Buffer.from(onchainCreationCode.substring(2), "hex"),
        Buffer.from(onchainRuntimeCode.substring(2), "hex"),
        Buffer.from(creationTransactionHash.substring(2), "hex"),
      ],
    );

    const jobStartTime = startTime.toISOString().replace(/\.\d{3}Z$/, "Z");
    const jobFinishTime = finishTime?.toISOString().replace(/\.\d{3}Z$/, "Z");
    return {
      isJobCompleted: isCompleted,
      verificationId,
      jobStartTime,
      ...(jobFinishTime ? { jobFinishTime } : {}),
      ...(compilationTime ? { compilationTime } : {}),
      contract: {
        match: isVerified ? "exact_match" : null,
        creationMatch: isVerified ? "exact_match" : null,
        runtimeMatch: isVerified ? "exact_match" : null,
        chainId: chainFixture.chainId,
        address: chainFixture.defaultContractAddress,
        ...(verifiedAt ? { verifiedAt } : {}),
        ...(matchId ? { matchId } : {}),
      },
      ...(error ? { error } : {}),
    };
  }

  it("should return a newly created job", async function () {
    const mockJob = await createMockJob();

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${mockJob.verificationId}`);

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.deep.equal(mockJob);
  });

  it("should return a job that has errors", async function () {
    const mockJob = await createMockJob(false, true);

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${mockJob.verificationId}`);

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.deep.equal(mockJob);
  });

  it("should return a job that has been verified", async function () {
    const mockJob = await createMockJob(true, false);

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${mockJob.verificationId}`);

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.deep.equal(mockJob);
  });

  it("should return 404 when job is not found", async function () {
    const nonExistentId = uuidv4();

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/verify/${nonExistentId}`);

    chai.expect(res.status).to.equal(404);
    chai.expect(res.body.customCode).to.equal("job_not_found");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });
});
