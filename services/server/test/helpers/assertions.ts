import { StatusCodes } from "http-status-codes";
import chai from "chai";
import config from "config";
import path from "path";
import fs from "fs";
import { getAddress, id } from "ethers";
import type { Response } from "superagent";
import type { Done } from "mocha";
import { Pool } from "pg";
import {
  Transformation,
  TransformationValues,
  VerificationStatus,
} from "@ethereum-sourcify/lib-sourcify";
import { ServerFixture } from "./ServerFixture";
import { getMatchStatus } from "../../src/server/apiv1/controllers.common";
import { MatchLevel } from "../../src/server/types";
import { toVerificationStatus } from "../../src/server/services/utils/util";
import chaiHttp from "chai-http";

chai.use(chaiHttp);

export const assertValidationError = (
  err: Error | null,
  res: Response,
  field: string,
  message?: string,
) => {
  try {
    chai.expect(err).to.be.null;
    chai.expect(res.body.message.toLowerCase()).to.include(field.toLowerCase());
    if (message) chai.expect(res.body.message).to.equal(message);
    chai.expect(res.status).to.equal(StatusCodes.BAD_REQUEST);
  } catch (err) {
    console.log("Not validating as expected:");
    console.log(JSON.stringify(res.body, null, 2));
    throw err;
  }
};

// If you pass storageService = false, then the match will not be compared to the database
export const assertVerification = async (
  serverFixture: ServerFixture | null,
  err: Error | null,
  res: Response,
  done: Done | null,
  expectedAddress: string,
  expectedChain: string,
  expectedStatus: VerificationStatus = "perfect",
) => {
  try {
    chai.expect(err).to.be.null;
    chai.expect(res.status).to.equal(StatusCodes.OK);
    chai.expect(res.body).to.haveOwnProperty("result");
    const resultArr = res.body.result;
    chai.expect(resultArr).to.have.a.lengthOf(1);
    const result = resultArr[0];
    chai
      .expect(result.address.toLowerCase())
      .to.equal(expectedAddress.toLowerCase());
    chai.expect(result.chainId).to.equal(expectedChain);
    chai.expect(result.status).to.equal(expectedStatus);

    await assertContractSaved(
      serverFixture?.sourcifyDatabase ?? null,
      expectedAddress,
      expectedChain,
      expectedStatus,
      serverFixture?.testS3Path ?? null,
      serverFixture?.testS3Bucket ?? null,
    );
    if (done) done();
  } catch (e) {
    throw new Error(
      `${(e as Error).message}\nResponse body: ${JSON.stringify(res.body)}`,
    );
  }
};

export const assertVerificationSession = async (
  serverFixture: ServerFixture | null,
  err: Error | null,
  res: Response,
  done: Done | null,
  expectedAddress: string | undefined,
  expectedChain: string | undefined,
  expectedStatus: VerificationStatus,
) => {
  try {
    chai.expect(err).to.be.null;
    chai.expect(res.status).to.equal(StatusCodes.OK);

    const contracts = res.body.contracts;
    chai.expect(contracts).to.have.a.lengthOf(1);
    const contract = contracts[0];

    chai.expect(contract.status).to.equal(expectedStatus);
    chai.expect(contract.address).to.equal(expectedAddress);
    chai.expect(contract.chainId).to.equal(expectedChain);

    chai.expect(contract.storageTimestamp).to.not.exist;
    chai.expect(contract.files.missing).to.be.empty;
    chai.expect(contract.files.invalid).to.be.empty;

    await assertContractSaved(
      serverFixture?.sourcifyDatabase ?? null,
      expectedAddress,
      expectedChain,
      expectedStatus,
      serverFixture?.testS3Path ?? null,
      serverFixture?.testS3Bucket ?? null,
    );
    if (done) done();
  } catch (e) {
    console.log(
      `Failing verification for ${expectedAddress} on chain #${expectedChain}.`,
    );
    console.log("Response body:");
    console.log(JSON.stringify(res.body, null, 2));
    console.log("Chai Error:");
    console.log(e);
    throw e;
  }
};

export async function assertTransformations(
  sourcifyDatabase: Pool,
  expectedAddress: string | undefined,
  expectedChain: string | undefined,
  expectedRuntimeTransformations: Transformation[] | null,
  expectedRuntimeTransformationValues: TransformationValues | null,
  expectedCreationTransformations: Transformation[] | null,
  expectedCreationTransformationValues: TransformationValues | null,
) {
  // Check if saved to the database
  const res = await sourcifyDatabase.query(
    `SELECT
      cd.address,
      cd.chain_id,
      vc.runtime_transformations,
      vc.runtime_values,
      vc.creation_transformations,
      vc.creation_values
    FROM sourcify_matches sm
    LEFT JOIN verified_contracts vc ON vc.id = sm.verified_contract_id
    LEFT JOIN contract_deployments cd ON cd.id = vc.deployment_id
    WHERE cd.address = $1 AND cd.chain_id = $2`,
    [Buffer.from(expectedAddress?.substring(2) ?? "", "hex"), expectedChain],
  );

  const contract = res.rows[0];
  chai.expect(contract).to.not.be.null;

  chai
    .expect("0x" + contract.address.toString("hex"))
    .to.equal(expectedAddress?.toLowerCase());
  chai.expect(contract.chain_id).to.equal(expectedChain);

  chai
    .expect(contract.runtime_transformations)
    .to.deep.equal(expectedRuntimeTransformations);
  chai
    .expect(contract.runtime_values)
    .to.deep.equal(expectedRuntimeTransformationValues);
  chai
    .expect(contract.creation_transformations)
    .to.deep.equal(expectedCreationTransformations);
  chai
    .expect(contract.creation_values)
    .to.deep.equal(expectedCreationTransformationValues);
}

export async function assertContractSaved(
  sourcifyDatabase: Pool | null,
  expectedAddress: string | undefined,
  expectedChain: string | undefined,
  expectedStatus: VerificationStatus,
  testS3Path?: string | null,
  testS3Bucket?: string | null,
) {
  if (expectedStatus === "perfect" || expectedStatus === "partial") {
    // Check if saved to fs repository
    const match = expectedStatus === "perfect" ? "full_match" : "partial_match";
    const getMetadataPath = (match: string) =>
      path.join(
        config.get("repositoryV1.path"),
        "contracts",
        match,
        expectedChain ?? "",
        getAddress(expectedAddress ?? ""),
        "metadata.json",
      );
    const metadataPath = getMetadataPath(match);
    const matchMetadadataExist = fs.existsSync(metadataPath);
    chai.expect(matchMetadadataExist, "Contract is not saved to filesystem").to
      .be.true;

    // If perfect match then check that partial match does not exist in the repository
    if (expectedStatus === "perfect") {
      const partialMatchMetadataPath = getMetadataPath("partial_match");
      chai.expect(
        fs.existsSync(partialMatchMetadataPath),
        "Partial match should not exist",
      ).to.be.false;
    }

    const expectedMetadataContent = fs.readFileSync(metadataPath).toString();
    const expectedMetadataHash = id(expectedMetadataContent);

    // Check if saved to S3
    if (testS3Path && testS3Bucket) {
      const getS3MetadataPath = (match: string) =>
        path.join(
          testS3Path,
          testS3Bucket,
          "contracts",
          match,
          expectedChain ?? "",
          getAddress(expectedAddress ?? ""),
          "metadata.json",
        );
      const s3MetadataPath = getS3MetadataPath(match);

      chai.expect(
        fs.existsSync(s3MetadataPath),
        "S3 metadata file should exist",
      ).to.be.true;

      // If perfect match then check that partial match does not exist in s3
      if (expectedStatus === "perfect") {
        const partialMatchS3MetadataPath = getS3MetadataPath("partial_match");
        chai.expect(
          fs.existsSync(partialMatchS3MetadataPath),
          "Partial match should not exist",
        ).to.be.false;
      }
      const s3Content = fs.readFileSync(s3MetadataPath).toString();
      chai
        .expect(id(s3Content))
        .to.equal(
          expectedMetadataHash,
          "S3 metadata hash doesn't match filesystem metadata hash",
        );
    }

    if (sourcifyDatabase) {
      // Check if saved to the database
      const res = await sourcifyDatabase.query(
        `SELECT
        cd.address,
        cd.chain_id,
        sm.creation_match,
        sm.runtime_match,
        sm.metadata
      FROM sourcify_matches sm
      LEFT JOIN verified_contracts vc ON vc.id = sm.verified_contract_id
      LEFT JOIN contract_deployments cd ON cd.id = vc.deployment_id
      LEFT JOIN compiled_contracts cc ON cc.id = vc.compilation_id 
      LEFT JOIN code compiled_runtime_code ON compiled_runtime_code.code_hash = cc.runtime_code_hash
      LEFT JOIN code compiled_creation_code ON compiled_creation_code.code_hash = cc.creation_code_hash
      WHERE cd.address = $1 AND cd.chain_id = $2`,
        [
          Buffer.from(expectedAddress?.substring(2) ?? "", "hex"),
          expectedChain,
        ],
      );

      const contract = res.rows[0];
      chai.expect(contract).to.not.be.null;
      chai
        .expect("0x" + contract.address.toString("hex"))
        .to.equal(expectedAddress?.toLowerCase());
      chai.expect(contract.chain_id).to.equal(expectedChain);
      chai
        .expect(id(JSON.stringify(contract.metadata)))
        .to.equal(expectedMetadataHash);

      // When we'll support runtime_match and creation_match as different statuses we can refine this statement
      chai
        .expect(
          getMatchStatus({
            runtimeMatch: contract.runtime_match,
            creationMatch: contract.creation_match,
          }),
        )
        .to.equal(expectedStatus);
    }
  }
}

export async function assertJobVerification(
  serverFixture: ServerFixture,
  verifyResponse: Response,
  resolveWorkers: () => Promise<void>,
  testChainId: string,
  testAddress: string,
  expectedMatch: MatchLevel,
) {
  chai
    .expect(verifyResponse.status)
    .to.equal(202, "Response body: " + JSON.stringify(verifyResponse.body));
  chai.expect(verifyResponse.body).to.have.property("verificationId");
  chai
    .expect(verifyResponse.body.verificationId)
    .to.match(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    );

  const jobRes = await chai
    .request(serverFixture.server.app)
    .get(`/v2/verify/${verifyResponse.body.verificationId}`);

  chai
    .expect(jobRes.status)
    .to.equal(200, "Response body: " + JSON.stringify(verifyResponse.body));
  chai.expect(jobRes.body).to.deep.include({
    isJobCompleted: false,
    verificationId: verifyResponse.body.verificationId,
    contract: {
      match: null,
      creationMatch: null,
      runtimeMatch: null,
      chainId: testChainId,
      address: testAddress,
    },
  });
  chai.expect(jobRes.body.error).to.be.undefined;

  await resolveWorkers();

  const jobRes2 = await chai
    .request(serverFixture.server.app)
    .get(`/v2/verify/${verifyResponse.body.verificationId}`);

  const verifiedContract = {
    match: expectedMatch,
    chainId: testChainId,
    address: testAddress,
  };

  chai
    .expect(jobRes2.status)
    .to.equal(200, "Response body: " + JSON.stringify(verifyResponse.body));
  chai.expect(jobRes2.body).to.include({
    isJobCompleted: true,
    verificationId: verifyResponse.body.verificationId,
  });
  chai.expect(jobRes2.body.error).to.be.undefined;
  chai.expect(jobRes2.body.contract).to.include(verifiedContract);

  const contractRes = await chai
    .request(serverFixture.server.app)
    .get(`/v2/contract/${testChainId}/${testAddress}`);

  chai
    .expect(contractRes.status)
    .to.equal(200, "Response body: " + JSON.stringify(verifyResponse.body));
  chai.expect(contractRes.body).to.include(verifiedContract);

  await assertContractSaved(
    serverFixture.sourcifyDatabase,
    testAddress,
    testChainId,
    toVerificationStatus(expectedMatch),
  );
}
