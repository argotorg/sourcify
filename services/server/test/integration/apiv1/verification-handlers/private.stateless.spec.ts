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
      false,
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

describe("/private/verify-deprecated", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();

  it("should verify a contract on deprecated chain (Goerli) and store it correctly in the database", async () => {
    const address = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f";
    const goerliChainId = "5";
    const matchStatus = "perfect";

    const res = await chai
      .request(serverFixture.server.app)
      .post("/private/verify-deprecated")
      .set("authorization", `Bearer sourcify-test-token`)
      .send({
        address: address,
        chain: goerliChainId,
        match: matchStatus,
        files: {
          "metadata.json": chainFixture.defaultContractMetadata.toString(),
          "Storage.sol": chainFixture.defaultContractSource.toString(),
        },
      });

    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      address,
      goerliChainId,
      matchStatus,
    );

    chai
      .expect(res.body.result[0].address.toLowerCase())
      .to.equal(address.toLowerCase());
    chai.expect(res.body.result[0].chainId).to.equal(goerliChainId);
    chai.expect(res.body.result[0].status).to.equal(matchStatus);

    const verificationDetails = await serverFixture.sourcifyDatabase.query(
      `SELECT
          runtime_match,
          creation_match,
          onchain_runtime_code.code as onchain_runtime_code,
          onchain_creation_code.code as onchain_creation_code,
          cd.chain_id,
          cd.block_number,
          cd.transaction_index,
          cd.transaction_hash,
          cd.deployer
        FROM verified_contracts vc
        LEFT JOIN contract_deployments cd ON cd.id = vc.deployment_id
        LEFT JOIN contracts c ON c.id = cd.contract_id
        LEFT JOIN code onchain_runtime_code ON onchain_runtime_code.code_hash = c.runtime_code_hash
        LEFT JOIN code onchain_creation_code ON onchain_creation_code.code_hash = c.creation_code_hash
        WHERE cd.address = $1`,
      [Buffer.from(address.substring(2), "hex")],
    );

    chai.expect(verificationDetails.rows.length).to.equal(1);
    const details = verificationDetails.rows[0];

    chai.expect(details.chain_id).to.equal(goerliChainId);
    chai.expect(details.block_number).to.equal("-1");
    chai.expect(details.transaction_index).to.equal("-1");
    chai.expect(details.transaction_hash).to.be.null;
    chai.expect(details.deployer).to.be.null;
    chai.expect(details.runtime_match).to.equal(true);
    chai.expect(details.creation_match).to.equal(true);

    const deprecatedMessage =
      "0x2121212121212121212121202d20636861696e207761732064657072656361746564206174207468652074696d65206f6620766572696669636174696f6e";
    const onchainRuntimeHex =
      "0x" + Buffer.from(details.onchain_runtime_code).toString("hex");
    const onchainCreationHex =
      "0x" + Buffer.from(details.onchain_creation_code).toString("hex");

    chai.expect(onchainRuntimeHex).to.equal(deprecatedMessage);
    chai.expect(onchainCreationHex).to.equal(deprecatedMessage);
  });
});
