import chai from "chai";
import path from "path";
import fs from "fs";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import {
  deployFromAbiAndBytecodeForCreatorTxHash,
  verifyContract,
} from "../../../helpers/helpers";
import { assertVerification } from "../../../helpers/assertions";
import chaiHttp from "chai-http";
import { StatusCodes } from "http-status-codes";

chai.use(chaiHttp);

describe("/private/replace-contract", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();

  it("should replace contract using existing database compilation (forceCompilation: false) and restore creation_match", async () => {
    // First, verify with perfect match
    await verifyContract(serverFixture, chainFixture);

    // Store the original creation_match value
    const originalMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT sm.creation_match as sm_creation_match, vc.* FROM sourcify_matches sm JOIN verified_contracts vc ON sm.verified_contract_id = vc.id",
    );

    // Manually corrupt the creation_match in the database
    await serverFixture.sourcifyDatabase.query(
      "UPDATE sourcify_matches SET creation_match = NULL",
    );

    await serverFixture.sourcifyDatabase.query(
      "UPDATE verified_contracts SET creation_transformations = NULL, creation_metadata_match = NULL, creation_values = NULL, creation_match = false",
    );

    // Verify the corruption
    const corruptedMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT sm.creation_match as sm_creation_match, vc.* FROM sourcify_matches sm JOIN verified_contracts vc ON sm.verified_contract_id = vc.id",
    );
    chai.expect(corruptedMatchResult.rows[0].sm_creation_match).to.be.null;
    chai.expect(corruptedMatchResult.rows[0].creation_match).to.be.false;
    chai.expect(corruptedMatchResult.rows[0].creation_transformations).to.be
      .null;
    chai.expect(corruptedMatchResult.rows[0].creation_metadata_match).to.be
      .null;
    chai.expect(corruptedMatchResult.rows[0].creation_values).to.be.null;

    // Call replace-contract endpoint with forceCompilation: false
    const replaceRes = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", `Bearer sourcify-test-token`)
      .send({
        address: chainFixture.defaultContractAddress,
        chainId: chainFixture.chainId,
        transactionHash: chainFixture.defaultContractCreatorTx,
        forceCompilation: false,
        forceRPCRequest: true,
        customReplaceMethod: "replace-creation-information",
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.OK);
    chai.expect(replaceRes.body.replaced).to.be.true;

    // Verify that creation_match is restored to original value
    const restoredMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT sm.creation_match as sm_creation_match, vc.* FROM sourcify_matches sm JOIN verified_contracts vc ON sm.verified_contract_id = vc.id",
    );
    chai
      .expect(restoredMatchResult.rows[0].sm_creation_match)
      .to.equal(originalMatchResult.rows[0].sm_creation_match);
    chai
      .expect(restoredMatchResult.rows[0].creation_match)
      .to.equal(originalMatchResult.rows[0].creation_match);
    chai
      .expect(restoredMatchResult.rows[0].creation_transformations)
      .to.deep.equal(originalMatchResult.rows[0].creation_transformations);
    chai
      .expect(restoredMatchResult.rows[0].creation_metadata_match)
      .to.deep.equal(originalMatchResult.rows[0].creation_metadata_match);
    chai
      .expect(restoredMatchResult.rows[0].creation_values)
      .to.deep.equal(originalMatchResult.rows[0].creation_values);
  });

  it("should replace a vyper match contract and remove old data", async () => {
    // Load Vyper test contract artifacts and source
    const vyperArtifact = (
      await import("../../../sources/vyper/testcontract/artifact.json")
    ).default;
    const vyperSourcePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "vyper",
      "testcontract",
      "test.vy",
    );
    const vyperSource = fs.readFileSync(vyperSourcePath, "utf8");

    // Deploy the Vyper contract
    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        vyperArtifact.abi,
        vyperArtifact.bytecode,
      );

    // First, verify the Vyper contract normally to get a partial match
    const res = await chai
      .request(serverFixture.server.app)
      .post("/verify/vyper")
      .send({
        address: contractAddress,
        chain: chainFixture.chainId,
        creatorTxHash: txHash,
        files: {
          "test.vy": vyperSource,
        },
        contractPath: "test.vy",
        contractName: "test",
        compilerVersion: "0.3.10+commit.91361694",
        compilerSettings: {
          evmVersion: "istanbul",
          outputSelection: {
            "*": ["evm.bytecode"],
          },
        },
      });

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      contractAddress,
      chainFixture.chainId,
      "partial",
    );

    // Store the original creation_match value
    const originalMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT sm.creation_match as sm_creation_match, vc.* FROM sourcify_matches sm JOIN verified_contracts vc ON sm.verified_contract_id = vc.id",
    );

    // Manually corrupt the creation_match in the database
    await serverFixture.sourcifyDatabase.query(
      "UPDATE sourcify_matches SET creation_match = NULL",
    );

    await serverFixture.sourcifyDatabase.query(
      "UPDATE verified_contracts SET creation_transformations = NULL, creation_metadata_match = NULL, creation_values = NULL, creation_match = false",
    );

    // Verify the corruption
    const corruptedMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT sm.creation_match as sm_creation_match, vc.* FROM sourcify_matches sm JOIN verified_contracts vc ON sm.verified_contract_id = vc.id",
    );
    chai.expect(corruptedMatchResult.rows[0].sm_creation_match).to.be.null;
    chai.expect(corruptedMatchResult.rows[0].creation_match).to.be.false;
    chai.expect(corruptedMatchResult.rows[0].creation_transformations).to.be
      .null;
    chai.expect(corruptedMatchResult.rows[0].creation_metadata_match).to.be
      .null;
    chai.expect(corruptedMatchResult.rows[0].creation_values).to.be.null;

    // Call replace-contract endpoint with forceCompilation: true for Vyper
    const replaceRes = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", `Bearer sourcify-test-token`)
      .send({
        address: contractAddress,
        chainId: chainFixture.chainId,
        transactionHash: txHash,
        forceCompilation: false,
        forceRPCRequest: true,
        customReplaceMethod: "replace-creation-information",
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.OK);
    chai.expect(replaceRes.body.replaced).to.be.true;

    // Verify that creation_match is restored to original value
    const restoredMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT sm.creation_match as sm_creation_match, vc.* FROM sourcify_matches sm JOIN verified_contracts vc ON sm.verified_contract_id = vc.id",
    );
    chai
      .expect(restoredMatchResult.rows[0].sm_creation_match)
      .to.equal(originalMatchResult.rows[0].sm_creation_match);
    chai
      .expect(restoredMatchResult.rows[0].creation_match)
      .to.equal(originalMatchResult.rows[0].creation_match);
    chai
      .expect(restoredMatchResult.rows[0].creation_transformations)
      .to.deep.equal(originalMatchResult.rows[0].creation_transformations);
    chai
      .expect(restoredMatchResult.rows[0].creation_metadata_match)
      .to.deep.equal(originalMatchResult.rows[0].creation_metadata_match);
    chai
      .expect(restoredMatchResult.rows[0].creation_values)
      .to.deep.equal(originalMatchResult.rows[0].creation_values);
  });
});
