import { StatusCodes } from "http-status-codes";
import chai from "chai";
import chaiHttp from "chai-http";
import type { Done } from "mocha";
import { QueryTypes, Sequelize } from "sequelize";
import type { Response } from "superagent";
import { VerificationStatus } from "@ethereum-sourcify/lib-sourcify";
import { ServerFixture } from "./ServerFixture";
import { getMatchStatus } from "../../services/utils/util";
import { MatchLevel } from "../../routes/types";
import { toVerificationStatus } from "../../services/utils/util";

chai.use(chaiHttp);

export async function assertContractSaved(
  sourcifyDatabase: Sequelize,
  expectedAddress: string | undefined,
  expectedChain: number | undefined,
  expectedStatus: VerificationStatus,
) {
  if (expectedStatus === "perfect" || expectedStatus === "partial") {
    // Check if saved to the database
    const list = await sourcifyDatabase.query(
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
      WHERE cd.address = ? AND cd.chain_id = ?`,
      {
        type: QueryTypes.SELECT,
        replacements: [expectedAddress, expectedChain],
      },
    );
    const contract: any = list?.length ? list[0] : null;

    chai.expect(contract).to.not.be.null;
    chai.expect(contract.address).to.equal(expectedAddress);
    chai.expect(contract.chain_id).to.equal(expectedChain);
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

export async function assertJobVerification(
  serverFixture: ServerFixture,
  verifyResponse: Response,
  resolveWorkers: () => Promise<void>,
  testChainId: number,
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
    .get(`/verify/${verifyResponse.body.verificationId}`);

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
    .get(`/verify/${verifyResponse.body.verificationId}`);

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
    .get(`/contract/${testChainId}/${testAddress}`);

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

// If you pass storageService = false, then the match will not be compared to the database
export const assertVerification = async (
  serverFixture: ServerFixture,
  err: Error | null,
  res: Response,
  done: Done | null,
  expectedAddress: string,
  expectedChain: number,
  expectedStatus: VerificationStatus = "perfect",
) => {
  try {
    chai.expect(err).to.be.null;
    chai.expect(res.status).to.equal(StatusCodes.OK);
    /*chai.expect(res.body).to.haveOwnProperty("result");
    const resultArr = res.body.result;
    chai.expect(resultArr).to.have.a.lengthOf(1);
    const result = resultArr[0];*/
    const result = res.body;
    chai
      .expect(result.address.toLowerCase())
      .to.equal(expectedAddress.toLowerCase());
    chai.expect(result.chainId).to.equal(expectedChain);
    chai.expect(toVerificationStatus(result.match)).to.equal(expectedStatus);

    await assertContractSaved(
      serverFixture.sourcifyDatabase,
      expectedAddress,
      expectedChain,
      expectedStatus,
    );
    if (done) done();
  } catch (e) {
    throw new Error(
      `${(e as Error).message}\nResponse body: ${JSON.stringify(res.body)}`,
    );
  }
};
