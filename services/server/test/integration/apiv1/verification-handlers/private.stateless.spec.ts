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

  it("should replace a partial match contract with perfect match using forceCompilation and remove old data", async () => {
    // First, create a partial match
    await verifyContract(
      serverFixture,
      chainFixture,
      undefined,
      undefined,
      true,
    );

    // Get the initial state before replacement
    const initialVerificationResult =
      await serverFixture.sourcifyDatabase.query(
        "SELECT id FROM verified_contracts",
      );
    chai.expect(initialVerificationResult.rows).to.have.length(1);

    // Get the compilation data needed for forceCompilation
    const solcJsonPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "testcontracts",
      "Storage",
      "StorageJsonInput.json",
    );
    const jsonInput = JSON.parse(fs.readFileSync(solcJsonPath, "utf8"));

    // Call replace-contract endpoint with forceCompilation: true
    const replaceRes = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", `Bearer sourcify-test-token`)
      .send({
        address: chainFixture.defaultContractAddress,
        chainId: chainFixture.chainId,
        transactionHash: chainFixture.defaultContractCreatorTx,
        forceCompilation: true,
        forceRPCRequest: false,
        jsonInput: jsonInput,
        compilerVersion: "0.8.4+commit.c7e474f2",
        compilationTarget: "project:/contracts/Storage.sol:Storage",
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.OK);
    chai.expect(replaceRes.body.replaced).to.be.true;
    chai
      .expect(replaceRes.body.address)
      .to.equal(chainFixture.defaultContractAddress);
    chai.expect(replaceRes.body.chainId).to.equal(chainFixture.chainId);
    chai.expect(replaceRes.body.newStatus.runtimeMatch).to.equal("perfect");
    chai.expect(replaceRes.body.newStatus.creationMatch).to.equal("perfect");

    // Verify that only the new verification exists in the database
    const finalVerificationResult = await serverFixture.sourcifyDatabase.query(
      "SELECT runtime_match, creation_match FROM verified_contracts",
    );
    chai.expect(finalVerificationResult.rows).to.have.length(1);
    chai.expect(finalVerificationResult.rows[0].runtime_match).to.be.true;
    chai.expect(finalVerificationResult.rows[0].creation_match).to.be.true;

    // Verify sourcify_matches table contains only the new perfect match
    const sourcifyMatchesResult = await serverFixture.sourcifyDatabase.query(
      "SELECT runtime_match, creation_match FROM sourcify_matches",
    );
    chai.expect(sourcifyMatchesResult.rows).to.have.length(1);
    chai
      .expect(sourcifyMatchesResult.rows[0].runtime_match)
      .to.equal("perfect");
    chai
      .expect(sourcifyMatchesResult.rows[0].creation_match)
      .to.equal("perfect");

    // Verify all other tables contain only the new contract data
    // Check compiled_contracts - should only have the new compilation
    const compiledContractsResult = await serverFixture.sourcifyDatabase.query(
      "SELECT COUNT(*) as count, name FROM compiled_contracts GROUP BY name",
    );
    chai.expect(compiledContractsResult.rows[0].name).to.equal("Storage");
    chai.expect(parseInt(compiledContractsResult.rows[0].count)).to.equal(1);

    // Check compiled_contracts_sources - should only have sources for the new compilation
    const compiledContractsSourcesResult =
      await serverFixture.sourcifyDatabase.query(
        "SELECT COUNT(*) as count FROM compiled_contracts_sources",
      );
    chai
      .expect(parseInt(compiledContractsSourcesResult.rows[0].count))
      .to.equal(1);

    // Check sources - should only have sources for the new contract
    const sourcesResult = await serverFixture.sourcifyDatabase.query(
      "SELECT COUNT(*) as count FROM sources",
    );
    chai.expect(parseInt(sourcesResult.rows[0].count)).to.equal(1);

    // Check contract_deployments - should only have the new deployment
    const contractDeploymentsResult =
      await serverFixture.sourcifyDatabase.query(
        "SELECT COUNT(*) as count, encode(address, 'hex') as address FROM contract_deployments GROUP BY address",
      );
    chai
      .expect(contractDeploymentsResult.rows[0].address.toLowerCase())
      .to.equal(chainFixture.defaultContractAddress.toLowerCase().substring(2));
    chai.expect(parseInt(contractDeploymentsResult.rows[0].count)).to.equal(1);

    // Check contracts - should only have the new contract
    const contractsResult = await serverFixture.sourcifyDatabase.query(
      "SELECT COUNT(*) as count FROM contracts",
    );
    chai.expect(parseInt(contractsResult.rows[0].count)).to.equal(1);

    // Check code - should only have code for the new contract (creation + runtime)
    const codeResult = await serverFixture.sourcifyDatabase.query(
      "SELECT COUNT(*) as count FROM code",
    );
    // Should have exactly 2 code entries: creation and runtime bytecode
    chai.expect(parseInt(codeResult.rows[0].count)).to.equal(2);
  });

  it("should replace contract using existing database compilation (forceCompilation: false) and restore creation_match", async () => {
    // First, verify with perfect match
    await verifyContract(serverFixture, chainFixture);

    // Store the original creation_match value
    const originalMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT creation_match FROM sourcify_matches",
    );
    const originalCreationMatch = originalMatchResult.rows[0].creation_match;

    // Manually corrupt the creation_match in the database
    await serverFixture.sourcifyDatabase.query(
      "UPDATE sourcify_matches SET creation_match = NULL",
    );

    // Verify the corruption
    const corruptedMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT creation_match FROM sourcify_matches",
    );
    chai.expect(corruptedMatchResult.rows[0].creation_match).to.be.null;

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
        forceRPCRequest: false,
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.OK);
    chai.expect(replaceRes.body.replaced).to.be.true;

    // Verify that creation_match is restored to original value
    const restoredMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT creation_match FROM sourcify_matches",
    );
    chai
      .expect(restoredMatchResult.rows[0].creation_match)
      .to.equal(originalCreationMatch);
  });

  it("should replace contract with forceRPCRequest: true and fix corrupted runtime bytecode", async () => {
    // First, verify with perfect match
    await verifyContract(serverFixture, chainFixture);

    // Get the original runtime bytecode
    const originalBytecodeResult = await serverFixture.sourcifyDatabase.query(
      `SELECT code.code_hash_keccak as runtime_bytecode_keccak
         FROM contracts c 
         JOIN code ON code.code_hash = c.runtime_code_hash 
         JOIN contract_deployments cd ON cd.contract_id = c.id 
         WHERE cd.address = $1`,
      [Buffer.from(chainFixture.defaultContractAddress.substring(2), "hex")],
    );
    const originalRuntimeBytecode =
      originalBytecodeResult.rows[0].runtime_bytecode_keccak;

    // Manually corrupt the runtime bytecode in the database
    await serverFixture.sourcifyDatabase.query(
      `UPDATE code SET code_hash_keccak = decode($1, 'hex')
         WHERE code_hash IN (
           SELECT c.runtime_code_hash 
           FROM contracts c 
           JOIN contract_deployments cd ON cd.contract_id = c.id 
           WHERE cd.address = $2
         )`,
      [
        "deadbeef",
        Buffer.from(chainFixture.defaultContractAddress.substring(2), "hex"),
      ],
    );

    // Call replace-contract endpoint with forceRPCRequest: true
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
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.OK);
    chai.expect(replaceRes.body.replaced).to.be.true;

    // Verify that runtime bytecode is restored to original value
    const restoredBytecodeResult = await serverFixture.sourcifyDatabase.query(
      `SELECT code.code_hash_keccak as runtime_bytecode_keccak
         FROM contracts c 
         JOIN code ON code.code_hash = c.runtime_code_hash 
         JOIN contract_deployments cd ON cd.contract_id = c.id 
         WHERE cd.address = $1`,
      [Buffer.from(chainFixture.defaultContractAddress.substring(2), "hex")],
    );
    chai
      .expect(restoredBytecodeResult.rows[0].runtime_bytecode_keccak)
      .to.deep.equal(originalRuntimeBytecode);
  });

  it("should replace contract with forceRPCRequest: false using database data and restore creation_match", async () => {
    // First, verify with perfect match
    await verifyContract(serverFixture, chainFixture);

    // Store the original creation_match value
    const originalMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT creation_match FROM sourcify_matches",
    );
    const originalCreationMatch = originalMatchResult.rows[0].creation_match;

    // Manually corrupt the creation_match in the database
    await serverFixture.sourcifyDatabase.query(
      "UPDATE sourcify_matches SET creation_match = NULL",
    );

    // Verify the corruption
    const corruptedMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT creation_match FROM sourcify_matches",
    );
    chai.expect(corruptedMatchResult.rows[0].creation_match).to.be.null;

    // Call replace-contract endpoint with forceRPCRequest: false (uses database data)
    const replaceRes = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", `Bearer sourcify-test-token`)
      .send({
        address: chainFixture.defaultContractAddress,
        chainId: chainFixture.chainId,
        transactionHash: chainFixture.defaultContractCreatorTx,
        forceCompilation: false,
        forceRPCRequest: false,
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.OK);
    chai.expect(replaceRes.body.replaced).to.be.true;

    // Verify that creation_match is restored to original value
    const restoredMatchResult = await serverFixture.sourcifyDatabase.query(
      "SELECT creation_match FROM sourcify_matches",
    );
    chai
      .expect(restoredMatchResult.rows[0].creation_match)
      .to.equal(originalCreationMatch);
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

    // Get the original runtime bytecode hash before corruption
    const originalBytecodeResult = await serverFixture.sourcifyDatabase.query(
      `SELECT code.code_hash_keccak as runtime_bytecode_keccak
         FROM contracts c 
         JOIN code ON code.code_hash = c.runtime_code_hash 
         JOIN contract_deployments cd ON cd.contract_id = c.id 
         WHERE cd.address = $1`,
      [Buffer.from(contractAddress.substring(2), "hex")],
    );
    const originalRuntimeBytecode =
      originalBytecodeResult.rows[0].runtime_bytecode_keccak;

    // Manually corrupt the runtime bytecode hash in the database to test replacement
    await serverFixture.sourcifyDatabase.query(
      `UPDATE code SET code_hash_keccak = decode($1, 'hex')
         WHERE code_hash IN (
           SELECT c.runtime_code_hash 
           FROM contracts c 
           JOIN contract_deployments cd ON cd.contract_id = c.id 
           WHERE cd.address = $2
         )`,
      ["deadbeef", Buffer.from(contractAddress.substring(2), "hex")],
    );

    // Prepare VyperJsonInput for force compilation
    const vyperJsonInput = {
      language: "Vyper" as const,
      sources: {
        "test.vy": {
          content: vyperSource,
        },
      },
      settings: {
        evmVersion: "istanbul" as const,
        outputSelection: {
          "*": ["evm.bytecode", "evm.deployedBytecode"],
        },
      },
    };

    // Call replace-contract endpoint with forceCompilation: true for Vyper
    const replaceRes = await chai
      .request(serverFixture.server.app)
      .post("/private/replace-contract")
      .set("authorization", `Bearer sourcify-test-token`)
      .send({
        address: contractAddress,
        chainId: chainFixture.chainId,
        transactionHash: txHash,
        forceCompilation: true,
        forceRPCRequest: false,
        jsonInput: vyperJsonInput,
        compilerVersion: "0.3.10+commit.91361694",
        compilationTarget: "test.vy:test",
      });

    chai.expect(replaceRes.status).to.equal(StatusCodes.OK);
    chai.expect(replaceRes.body.replaced).to.be.true;
    chai.expect(replaceRes.body.address).to.equal(contractAddress);
    chai.expect(replaceRes.body.chainId).to.equal(chainFixture.chainId);
    chai.expect(replaceRes.body.newStatus.runtimeMatch).to.equal("partial");
    chai.expect(replaceRes.body.newStatus.creationMatch).to.equal("partial");

    // Verify that runtime bytecode hash was restored to original value
    const restoredBytecodeResult = await serverFixture.sourcifyDatabase.query(
      `SELECT code.code_hash_keccak as runtime_bytecode_keccak
         FROM contracts c 
         JOIN code ON code.code_hash = c.runtime_code_hash 
         JOIN contract_deployments cd ON cd.contract_id = c.id 
         WHERE cd.address = $1`,
      [Buffer.from(contractAddress.substring(2), "hex")],
    );
    chai
      .expect(restoredBytecodeResult.rows[0].runtime_bytecode_keccak)
      .to.deep.equal(originalRuntimeBytecode);

    // Verify all database tables contain only the new Vyper contract data
    const finalVerificationResult = await serverFixture.sourcifyDatabase.query(
      "SELECT runtime_match, creation_match FROM verified_contracts",
    );
    chai.expect(finalVerificationResult.rows).to.have.length(1);
    chai.expect(finalVerificationResult.rows[0].runtime_match).to.be.true;
    chai.expect(finalVerificationResult.rows[0].creation_match).to.be.true;

    // Verify sourcify_matches table contains only the new partial match
    const sourcifyMatchesResult = await serverFixture.sourcifyDatabase.query(
      "SELECT runtime_match, creation_match FROM sourcify_matches",
    );
    chai.expect(sourcifyMatchesResult.rows).to.have.length(1);
    chai
      .expect(sourcifyMatchesResult.rows[0].runtime_match)
      .to.equal("partial");
    chai
      .expect(sourcifyMatchesResult.rows[0].creation_match)
      .to.equal("partial");

    // Check compiled_contracts - should only have the new Vyper compilation
    const compiledContractsResult = await serverFixture.sourcifyDatabase.query(
      "SELECT COUNT(*) as count, name, language FROM compiled_contracts GROUP BY name, language",
    );
    chai.expect(compiledContractsResult.rows[0].name).to.equal("test");
    chai.expect(compiledContractsResult.rows[0].language).to.equal("vyper");
    chai.expect(parseInt(compiledContractsResult.rows[0].count)).to.equal(1);

    // Check compiled_contracts_sources - should only have sources for the new compilation
    const compiledContractsSourcesResult =
      await serverFixture.sourcifyDatabase.query(
        "SELECT COUNT(*) as count FROM compiled_contracts_sources",
      );
    chai
      .expect(parseInt(compiledContractsSourcesResult.rows[0].count))
      .to.equal(1);

    // Check sources - should only have sources for the new contract
    const sourcesResult = await serverFixture.sourcifyDatabase.query(
      "SELECT COUNT(*) as count FROM sources",
    );
    chai.expect(parseInt(sourcesResult.rows[0].count)).to.equal(1);

    // Check contract_deployments - should only have the new deployment
    const contractDeploymentsResult =
      await serverFixture.sourcifyDatabase.query(
        "SELECT COUNT(*) as count, encode(address, 'hex') as address FROM contract_deployments GROUP BY address",
      );
    chai
      .expect(contractDeploymentsResult.rows[0].address.toLowerCase())
      .to.equal(contractAddress.toLowerCase().substring(2));
    chai.expect(parseInt(contractDeploymentsResult.rows[0].count)).to.equal(1);

    // Check contracts - should only have the new contract
    const contractsResult = await serverFixture.sourcifyDatabase.query(
      "SELECT COUNT(*) as count FROM contracts",
    );
    chai.expect(parseInt(contractsResult.rows[0].count)).to.equal(1);

    // Check code - should only have code for the new contract (creation + runtime)
    const codeResult = await serverFixture.sourcifyDatabase.query(
      "SELECT COUNT(*) as count FROM code",
    );
    // Should have exactly 2 code entries: creation and runtime bytecode
    chai.expect(parseInt(codeResult.rows[0].count)).to.equal(2);
  });
});
