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
import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { LOCAL_CHAINS } from "../../../../src/sourcify-chains";

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

  it("should backfill missing Vyper immutableReferences with the replace-vyper-immutable-references method", async () => {
    // Load Vyper-with-immutables test contract artifacts and source
    const vyperArtifact = (
      await import("../../../sources/vyper/withImmutables/artifact.json")
    ).default;
    const vyperSourcePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "vyper",
      "withImmutables",
      "test.vy",
    );
    const vyperSource = fs.readFileSync(vyperSourcePath, "utf8");

    const compilerVersion = "0.4.0+commit.e9db8d9f";
    const compilerSettings = {
      evmVersion: "london",
      optimize: "codesize",
      outputSelection: { "*": ["evm.bytecode"] },
    };

    // Deploy the Vyper contract (constructor sets an immutable uint256 value)
    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        vyperArtifact.abi,
        vyperArtifact.bytecode,
        [5],
      );

    // Verify the contract. With the #2817 fix this persists immutableReferences.
    const res = await chai
      .request(serverFixture.server.app)
      .post("/verify/vyper")
      .send({
        address: contractAddress,
        chain: chainFixture.chainId,
        creatorTxHash: txHash,
        files: { "test.vy": vyperSource },
        contractPath: "test.vy",
        contractName: "test",
        compilerVersion,
        compilerSettings,
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

    // Capture the freshly stored runtime_code_artifacts (with immutableReferences)
    const originalArtifactsResult = await serverFixture.sourcifyDatabase.query(
      "SELECT fully_qualified_name, runtime_code_artifacts FROM compiled_contracts",
    );
    const compiledContract = originalArtifactsResult.rows[0];
    const originalArtifacts = compiledContract.runtime_code_artifacts;

    // Sanity check: the fix stores non-empty immutableReferences for this contract
    chai.expect(originalArtifacts.immutableReferences).to.not.be.null;
    chai
      .expect(Object.keys(originalArtifacts.immutableReferences))
      .to.have.lengthOf.greaterThan(0);

    // Simulate the legacy bug state: immutableReferences was never persisted
    await serverFixture.sourcifyDatabase.query(
      `UPDATE compiled_contracts
         SET runtime_code_artifacts = jsonb_set(
           runtime_code_artifacts, '{immutableReferences}', 'null'::jsonb)`,
    );

    // Verify the simulated corruption
    const corruptedResult = await serverFixture.sourcifyDatabase.query(
      "SELECT runtime_code_artifacts FROM compiled_contracts",
    );
    chai.expect(
      corruptedResult.rows[0].runtime_code_artifacts.immutableReferences,
    ).to.be.null;

    // Call replace-contract with the new replace-vyper-immutable-references method
    const replaceRes = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", `Bearer sourcify-test-token`)
      .send({
        address: contractAddress,
        chainId: chainFixture.chainId,
        forceCompilation: true,
        jsonInput: {
          language: "Vyper",
          sources: { "test.vy": { content: vyperSource } },
          settings: compilerSettings,
        },
        compilerVersion,
        compilationTarget: compiledContract.fully_qualified_name,
        forceRPCRequest: false,
        customReplaceMethod: "replace-vyper-immutable-references",
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.OK);
    chai.expect(replaceRes.body.replaced).to.be.true;

    // immutableReferences restored; the other artifacts must be untouched
    const restoredResult = await serverFixture.sourcifyDatabase.query(
      "SELECT runtime_code_artifacts FROM compiled_contracts",
    );
    const restoredArtifacts = restoredResult.rows[0].runtime_code_artifacts;
    chai
      .expect(restoredArtifacts.immutableReferences)
      .to.deep.equal(originalArtifacts.immutableReferences);
    chai
      .expect(restoredArtifacts.sourceMap)
      .to.deep.equal(originalArtifacts.sourceMap);
    chai
      .expect(restoredArtifacts.cborAuxdata)
      .to.deep.equal(originalArtifacts.cborAuxdata);
    chai
      .expect(restoredArtifacts.linkReferences)
      .to.deep.equal(originalArtifacts.linkReferences);
  });

  it("should skip (replaced=false) when a Vyper contract has no immutables", async () => {
    // The testcontract has no immutables, so the method must be a no-op
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

    const compilerVersion = "0.3.10+commit.91361694";
    const compilerSettings = {
      evmVersion: "istanbul",
      outputSelection: { "*": ["evm.bytecode"] },
    };

    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        vyperArtifact.abi,
        vyperArtifact.bytecode,
      );

    const res = await chai
      .request(serverFixture.server.app)
      .post("/verify/vyper")
      .send({
        address: contractAddress,
        chain: chainFixture.chainId,
        creatorTxHash: txHash,
        files: { "test.vy": vyperSource },
        contractPath: "test.vy",
        contractName: "test",
        compilerVersion,
        compilerSettings,
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

    const replaceRes = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", `Bearer sourcify-test-token`)
      .send({
        address: contractAddress,
        chainId: chainFixture.chainId,
        forceCompilation: true,
        jsonInput: {
          language: "Vyper",
          sources: { "test.vy": { content: vyperSource } },
          settings: compilerSettings,
        },
        compilerVersion,
        compilationTarget: "test.vy:test",
        forceRPCRequest: false,
        customReplaceMethod: "replace-vyper-immutable-references",
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.OK);
    chai.expect(replaceRes.body.replaced).to.be.false;
    chai.expect(replaceRes.body.replacedReason).to.be.a("string");

    // immutableReferences stays null
    const result = await serverFixture.sourcifyDatabase.query(
      "SELECT runtime_code_artifacts FROM compiled_contracts",
    );
    chai.expect(result.rows[0].runtime_code_artifacts.immutableReferences).to.be
      .null;
  });

  it("should throw when multiple verified contracts exist for the same chain and address", async () => {
    // Use the with-immutables contract so the method gets past the no-immutables
    // skip and reaches the duplicate check.
    const vyperArtifact = (
      await import("../../../sources/vyper/withImmutables/artifact.json")
    ).default;
    const vyperSourcePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "vyper",
      "withImmutables",
      "test.vy",
    );
    const vyperSource = fs.readFileSync(vyperSourcePath, "utf8");

    const compilerVersion = "0.4.0+commit.e9db8d9f";
    const compilerSettings = {
      evmVersion: "london",
      optimize: "codesize",
      outputSelection: { "*": ["evm.bytecode"] },
    };

    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        vyperArtifact.abi,
        vyperArtifact.bytecode,
        [5],
      );

    const res = await chai
      .request(serverFixture.server.app)
      .post("/verify/vyper")
      .send({
        address: contractAddress,
        chain: chainFixture.chainId,
        creatorTxHash: txHash,
        files: { "test.vy": vyperSource },
        contractPath: "test.vy",
        contractName: "test",
        compilerVersion,
        compilerSettings,
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

    // Create a second verified_contract (+ deployment + sourcify_match) for the
    // same chain/address. The deployment is cloned with a different
    // transaction_hash so it satisfies the (chain_id, address, transaction_hash,
    // contract_id) unique constraint, and the verified_contract reuses the same
    // compilation_id with the new deployment_id.
    await serverFixture.sourcifyDatabase.query(`
      WITH new_dep AS (
        INSERT INTO contract_deployments (chain_id, address, transaction_hash, block_number, transaction_index, deployer, contract_id)
        SELECT chain_id, address, decode(repeat('ab', 32), 'hex'), block_number, transaction_index, deployer, contract_id
        FROM contract_deployments
        LIMIT 1
        RETURNING id
      ),
      new_vc AS (
        INSERT INTO verified_contracts (deployment_id, compilation_id, creation_match, creation_values, creation_transformations, creation_metadata_match, runtime_match, runtime_values, runtime_transformations, runtime_metadata_match)
        SELECT new_dep.id, v.compilation_id, v.creation_match, v.creation_values, v.creation_transformations, v.creation_metadata_match, v.runtime_match, v.runtime_values, v.runtime_transformations, v.runtime_metadata_match
        FROM verified_contracts v CROSS JOIN new_dep
        LIMIT 1
        RETURNING id
      )
      INSERT INTO sourcify_matches (verified_contract_id, creation_match, runtime_match, chain_id)
      SELECT new_vc.id, sm.creation_match, sm.runtime_match, sm.chain_id
      FROM sourcify_matches sm CROSS JOIN new_vc
      LIMIT 1
    `);

    // Sanity: two verified contracts now exist for this chain/address
    const countResult = await serverFixture.sourcifyDatabase.query(
      "SELECT count(*)::int AS n FROM verified_contracts",
    );
    chai.expect(countResult.rows[0].n).to.equal(2);

    const replaceRes = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", `Bearer sourcify-test-token`)
      .send({
        address: contractAddress,
        chainId: chainFixture.chainId,
        forceCompilation: true,
        jsonInput: {
          language: "Vyper",
          sources: { "test.vy": { content: vyperSource } },
          settings: compilerSettings,
        },
        compilerVersion,
        compilationTarget: "test.vy:test",
        forceRPCRequest: false,
        customReplaceMethod: "replace-vyper-immutable-references",
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.INTERNAL_SERVER_ERROR);
    chai
      .expect(replaceRes.body.error)
      .to.contain("Multiple verified contracts");
  });
});

describe("/private/verify-deprecated", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture({
    chains: {
      ...Object.fromEntries(LOCAL_CHAINS.map((c) => [c.chainId.toString(), c])),
      "5": new SourcifyChain({
        name: "Goerli (deprecated stub)",
        chainId: 5,
        supported: false,
        rpcs: [],
      }),
    },
  });

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
