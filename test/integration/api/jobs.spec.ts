import chai from "chai";
import chaiHttp from "chai-http";
import { ServerFixture } from "../../helpers/ServerFixture";
import { VerificationJob } from "../../../routes/types";
import { v4 as uuidv4 } from "uuid";
import { LocalChainFixture } from "../../helpers/LocalChainFixture";
import {
  getVerificationErrorMessage,
  MatchingErrorResponse,
} from "../../../routes/api/errors";
import { verifyContract } from "../../helpers/helpers";
import { JobErrorData } from "../../../services/store/Tables";
import { QueryTypes } from "sequelize";
import moment from "moment";

chai.use(chaiHttp);

describe("GET /verify/:verificationId", function () {
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
    let matchId: number | undefined;
    let verifiedContractId: string | undefined;

    if (isVerified) {
      await verifyContract(serverFixture, chainFixture);

      // Get the verification details from the database
      const verificationResult: any[] =
        await serverFixture.sourcifyDatabase.query(
          `SELECT 
          sm.id as match_id,
          
          DATE_FORMAT(sm.created_at, '%Y-%m-%d %H:%i:%s') AS verified_at,
          vc.id as verified_contract_id
        FROM verified_contracts vc
        JOIN sourcify_matches sm ON sm.verified_contract_id = vc.id
        JOIN contract_deployments cd ON cd.id = vc.deployment_id
        WHERE cd.address = ? AND cd.chain_id = ?`,
          {
            type: QueryTypes.SELECT,
            replacements: [
              chainFixture.defaultContractAddress,
              chainFixture.chainId,
            ],
          },
        );
      verifiedAt = verificationResult[0].verified_at;
      matchId = verificationResult[0].match_id;
      verifiedContractId = verificationResult[0].verified_contract_id;
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      {
        type: QueryTypes.INSERT,
        replacements: [
          verificationId,
          startTime,
          finishTime,
          compilationTime,
          chainFixture.chainId,
          chainFixture.defaultContractAddress,
          verifiedContractId || null,
          error?.customCode || null,
          error?.errorId || null,
          JSON.stringify(errorData),
          "/verify",
        ],
      },
    );

    await serverFixture.sourcifyDatabase.query(
      `INSERT INTO verification_jobs_ephemeral (
        id,
        recompiled_creation_code,
        recompiled_runtime_code,
        onchain_creation_code,
        onchain_runtime_code,
        creation_transaction_hash
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      {
        type: QueryTypes.INSERT,
        replacements: [
          verificationId,
          recompiledCreationCode,
          recompiledRuntimeCode,
          onchainCreationCode,
          onchainRuntimeCode,
          creationTransactionHash,
        ],
      },
    );

    // const jobStartTime = startTime.toISOString().replace(/\.\d{3}Z$/, "Z");
    // const jobFinishTime = finishTime?.toISOString().replace(/\.\d{3}Z$/, "Z");
    const jobStartTime = moment(startTime).format("YYYY-MM-DD HH:mm:ss");
    const jobFinishTime =
      finishTime && moment(finishTime).format("YYYY-MM-DD HH:mm:ss");
    return {
      isJobCompleted: isCompleted,
      verificationId,
      jobStartTime,
      ...(jobFinishTime ? { jobFinishTime } : {}),
      ...(compilationTime
        ? { compilationTime: parseInt(compilationTime) }
        : {}),
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
      .get(`/verify/${mockJob.verificationId}`);

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.deep.equal(mockJob);
  });

  it("should return a job that has errors", async function () {
    const mockJob = await createMockJob(false, true);

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/verify/${mockJob.verificationId}`);

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.deep.equal(mockJob);
  });

  it("should return a job that has been verified", async function () {
    const mockJob = await createMockJob(true, false);

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/verify/${mockJob.verificationId}`);

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.deep.equal(mockJob);
  });

  it("should return 404 when job is not found", async function () {
    const nonExistentId = uuidv4();

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/verify/${nonExistentId}`);

    chai.expect(res.status).to.equal(404);
    chai.expect(res.body.customCode).to.equal("job_not_found");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });
});
