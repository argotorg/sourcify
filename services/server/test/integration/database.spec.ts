import chai from "chai";
import chaiHttp from "chai-http";
import { deployFromAbiAndBytecodeForCreatorTxHash } from "../helpers/helpers";
import { id as keccak256str, keccak256 } from "ethers";
import { LocalChainFixture } from "../helpers/LocalChainFixture";
import { ServerFixture } from "../helpers/ServerFixture";
import type { MetadataSourceMap } from "@ethereum-sourcify/lib-sourcify";
import { Database } from "../../src/server/services/utils/Database";
import { bytesFromString } from "../../src/server/services/utils/database-util";
import crypto from "crypto";
import { Bytes } from "../../src/server/types";
import sinon from "sinon";
import { assertVerification } from "../helpers/assertions";
import path from "path";
import fs from "fs";
import { splitFullyQualifiedName } from "@ethereum-sourcify/lib-sourcify";

chai.use(chaiHttp);

function toHexString(byteArray: number[]) {
  return Array.from(byteArray, function (byte) {
    return ("0" + (byte & 0xff).toString(16)).slice(-2);
  }).join("");
}

function sha3_256(data: Bytes) {
  const hash = crypto.createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

describe("Verifier Alliance database", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();

  const verifierAllianceTest = async (testCase: any) => {
    const constructorArguments =
      testCase?.creation_values?.constructorArguments;
    const { contractAddress, txHash, blockNumber, txIndex } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        testCase.compilation_artifacts.abi,
        constructorArguments
          ? testCase.compiled_creation_code
          : testCase.deployed_creation_code,
        constructorArguments ? [constructorArguments] : undefined,
      );

    const compilationTarget: Record<string, string> = {};
    const { contractPath, contractName } = splitFullyQualifiedName(
      testCase.fully_qualified_name,
    );
    compilationTarget[contractPath] = contractName;
    const sources: MetadataSourceMap = {};
    Object.keys(testCase.sources).forEach((path) => {
      sources[path] = {
        content: testCase.sources[path],
        keccak256: keccak256str(testCase.sources[path]),
        urls: [],
      };
    });
    const metadataCompilerSettings = {
      ...testCase.compiler_settings,
      // Convert the libraries from the compiler_settings format to the metadata format
      libraries: Object.keys(testCase.compiler_settings.libraries || {}).reduce(
        (libraries: Record<string, string>, contractPath) => {
          Object.keys(
            testCase.compiler_settings.libraries[contractPath],
          ).forEach((contractName) => {
            libraries[`${contractPath}:${contractName}`] =
              testCase.compiler_settings.libraries[contractPath][contractName];
          });

          return libraries;
        },
        {},
      ),
    };
    await chai
      .request(serverFixture.server.app)
      .post("/")
      .send({
        address: contractAddress,
        chain: chainFixture.chainId,
        creatorTxHash: txHash,
        files: {
          "metadata.json": JSON.stringify({
            compiler: {
              version: testCase.version,
            },
            language: "Solidity",
            output: {
              abi: [],
              devdoc: {},
              userdoc: {},
            },
            settings: {
              ...metadataCompilerSettings,
              compilationTarget,
            },
            sources,
            version: 1,
          }),
          ...testCase.sources,
        },
      });
    await assertDatabase(
      testCase,
      contractAddress,
      txHash,
      blockNumber,
      txIndex,
    );
  };

  const verifierAllianceTestVyper = async (testCase: any) => {
    const constructorArguments =
      testCase?.creation_values?.constructorArguments;
    const { contractAddress, txHash, blockNumber, txIndex } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        testCase.compilation_artifacts.abi,
        constructorArguments
          ? testCase.compiled_creation_code
          : testCase.deployed_creation_code,
        constructorArguments ? [constructorArguments] : undefined,
      );

    const { contractPath } = splitFullyQualifiedName(
      testCase.fully_qualified_name,
    );
    await chai.request(serverFixture.server.app).post("/verify/vyper").send({
      address: contractAddress,
      chain: chainFixture.chainId,
      creatorTxHash: txHash,
      files: testCase.sources,
      compilerVersion: testCase.version,
      compilerSettings: testCase.compiler_settings,
      contractPath,
      contractName: testCase.name,
    });

    await assertDatabase(
      testCase,
      contractAddress,
      txHash,
      blockNumber,
      txIndex,
    );
  };

  const assertDatabase = async (
    testCase: any,
    address: string,
    txHash: string,
    blockNumber: number | null,
    txIndex: number | undefined,
  ) => {
    if (!serverFixture.sourcifyDatabase) {
      chai.assert.fail("No database on StorageService");
    }
    const addressBuffer = Buffer.from(address.substring(2), "hex");
    const res = await serverFixture.sourcifyDatabase.query(
      `SELECT 
          compilation_artifacts,
          creation_code_artifacts,
          runtime_code_artifacts,
          creation_match,
          creation_values,
          creation_transformations,
          creation_metadata_match,
          runtime_match,
          runtime_values,
          runtime_transformations,
          runtime_metadata_match,
          compiled_runtime_code.code as compiled_runtime_code,
          compiled_creation_code.code as compiled_creation_code,
          compiled_runtime_code.code_hash as compiled_runtime_code_hash,
          compiled_creation_code.code_hash as compiled_creation_code_hash,
          compiled_runtime_code.code_hash_keccak as compiled_runtime_code_hash_keccak,
          compiled_creation_code.code_hash_keccak as compiled_creation_code_hash_keccak,
          onchain_runtime_code.code as onchain_runtime_code,
          onchain_creation_code.code as onchain_creation_code,
          onchain_runtime_code.code_hash as onchain_runtime_code_hash,
          onchain_creation_code.code_hash as onchain_creation_code_hash,
          onchain_runtime_code.code_hash_keccak as onchain_runtime_code_hash_keccak,
          onchain_creation_code.code_hash_keccak as onchain_creation_code_hash_keccak,
          cc.compiler,
          cc.version,
          cc.language,
          cc.name,
          cc.fully_qualified_name,
          cc.compiler_settings,
          cd.chain_id,
          cd.address,
          cd.transaction_hash,
          cd.block_number,
          cd.transaction_index,
          cd.deployer
        FROM verified_contracts vc
        LEFT JOIN contract_deployments cd ON cd.id = vc.deployment_id
        LEFT JOIN contracts c ON c.id = cd.contract_id
        LEFT JOIN compiled_contracts cc ON cc.id = vc.compilation_id 
        LEFT JOIN code compiled_runtime_code ON compiled_runtime_code.code_hash = cc.runtime_code_hash
        LEFT JOIN code compiled_creation_code ON compiled_creation_code.code_hash = cc.creation_code_hash
        LEFT JOIN code onchain_runtime_code ON onchain_runtime_code.code_hash = c.runtime_code_hash
        LEFT JOIN code onchain_creation_code ON onchain_creation_code.code_hash = c.creation_code_hash
        where cd.address = $1`,
      [addressBuffer],
    );
    const resSources = await serverFixture.sourcifyDatabase.query(
      `SELECT
          ccs.*,
          s.*
        FROM verified_contracts vc
        LEFT JOIN contract_deployments cd ON cd.id = vc.deployment_id
        LEFT JOIN compiled_contracts cc ON cc.id = vc.compilation_id 
        LEFT JOIN compiled_contracts_sources ccs on ccs.compilation_id = cc.id
        LEFT JOIN sources s ON s.source_hash = ccs.source_hash
        where cd.address = $1`,
      [addressBuffer],
    );
    chai.expect(res.rowCount).to.equal(1);

    const row = res.rows[0];

    chai.expect(row.compiler).to.equal(testCase.compiler);
    chai.expect(row.version).to.equal(testCase.version);
    chai.expect(row.language).to.equal(testCase.language);
    chai.expect(row.name).to.equal(testCase.name);
    chai
      .expect(row.fully_qualified_name)
      .to.equal(testCase.fully_qualified_name);
    chai
      .expect(
        resSources.rows.reduce((sources, source) => {
          sources[source.path] = source.content;
          return sources;
        }, {}),
      )
      .to.deep.equal(testCase.sources);
    chai
      .expect(row.compiler_settings)
      .to.deep.equal(testCase.compiler_settings);
    chai.expect(row.chain_id).to.equal(chainFixture.chainId);
    chai
      .expect(row.address)
      .to.deep.equal(Buffer.from(address.substring(2), "hex"));

    chai
      .expect(row.deployer)
      .to.deep.equal(
        Buffer.from(chainFixture.localSigner.address.substring(2), "hex"),
      );

    chai
      .expect(row.transaction_hash)
      .to.deep.equal(Buffer.from(txHash.substring(2), "hex"));

    chai.expect(parseInt(row.block_number)).to.equal(blockNumber);
    chai.expect(parseInt(row.transaction_index)).to.equal(txIndex);

    // Check Keccak256 for code.code_hash_keccak
    chai
      .expect(`0x${toHexString(row.compiled_creation_code_hash_keccak)}`)
      .to.equal(keccak256(bytesFromString(testCase.compiled_creation_code)));
    chai
      .expect(`0x${toHexString(row.compiled_runtime_code_hash_keccak)}`)
      .to.equal(keccak256(bytesFromString(testCase.compiled_runtime_code)));
    chai
      .expect(`0x${toHexString(row.onchain_creation_code_hash_keccak)}`)
      .to.equal(keccak256(bytesFromString(testCase.deployed_creation_code)));
    chai
      .expect(`0x${toHexString(row.onchain_runtime_code_hash_keccak)}`)
      .to.equal(keccak256(bytesFromString(testCase.deployed_runtime_code)));
    chai
      .expect(row.compilation_artifacts)
      .to.deep.equal(testCase.compilation_artifacts);
    chai
      .expect(`0x${toHexString(row.compiled_runtime_code)}`)
      .to.equal(testCase.compiled_runtime_code);
    chai
      .expect(toHexString(row.compiled_runtime_code_hash))
      .to.equal(sha3_256(bytesFromString(testCase.compiled_runtime_code)));
    chai
      .expect(toHexString(row.onchain_runtime_code_hash))
      .to.equal(sha3_256(bytesFromString(testCase.deployed_runtime_code)));
    chai
      .expect(`0x${toHexString(row.onchain_runtime_code)}`)
      .to.equal(testCase.deployed_runtime_code);
    chai
      .expect(row.runtime_code_artifacts)
      .to.deep.equal(testCase.runtime_code_artifacts);
    chai.expect(row.runtime_match).to.deep.equal(testCase.runtime_match);
    chai.expect(row.runtime_values).to.deep.equal(testCase.runtime_values);
    chai
      .expect(row.runtime_transformations)
      .to.deep.equal(testCase.runtime_transformations);
    chai
      .expect(row.runtime_metadata_match)
      .to.equal(testCase.runtime_metadata_match);

    chai
      .expect(toHexString(row.compiled_creation_code_hash))
      .to.equal(sha3_256(bytesFromString(testCase.compiled_creation_code)));
    chai
      .expect(`0x${toHexString(row.compiled_creation_code)}`)
      .to.equal(testCase.compiled_creation_code);
    chai
      .expect(toHexString(row.onchain_creation_code_hash))
      .to.equal(sha3_256(bytesFromString(testCase.deployed_creation_code)));
    chai
      .expect(`0x${toHexString(row.onchain_creation_code)}`)
      .to.equal(testCase.deployed_creation_code);
    chai
      .expect(row.creation_code_artifacts)
      .to.deep.equal(testCase.creation_code_artifacts);
    chai.expect(row.creation_match).to.deep.equal(testCase.creation_match);
    chai.expect(row.creation_values).to.deep.equal(testCase.creation_values);
    chai
      .expect(row.creation_transformations)
      .to.deep.equal(testCase.creation_transformations);
    chai
      .expect(row.creation_metadata_match)
      .to.equal(testCase.creation_metadata_match);
  };

  it("Libraries have been linked manually instead of using compiler settings. Placeholders are replaced with zero addresses", async () => {
    const verifierAllianceTestLibrariesManuallyLinked = await import(
      "../verifier-alliance/libraries_manually_linked.json"
    );
    await verifierAllianceTest(verifierAllianceTestLibrariesManuallyLinked);
  });

  it("Store full match in database", async () => {
    const verifierAllianceTestFullMatch = await import(
      "../verifier-alliance/full_match.json"
    );
    await verifierAllianceTest(verifierAllianceTestFullMatch);
  });

  it("Store match with immutables in sourcify database", async () => {
    const verifierAllianceTestImmutables = await import(
      "../verifier-alliance/immutables.json"
    );
    await verifierAllianceTest(verifierAllianceTestImmutables);
  });

  it("Libraries have been linked using compiler settings. The placeholders are already replaced inside the compiled bytecode, and no link references provided", async () => {
    const verifierAllianceTestLibrariesLinkedByCompiler = await import(
      "../verifier-alliance/libraries_linked_by_compiler.json"
    );
    await verifierAllianceTest(verifierAllianceTestLibrariesLinkedByCompiler);
  });

  it("Store match without auxdata in database", async () => {
    const verifierAllianceTestMetadataHashAbsent = await import(
      "../verifier-alliance/metadata_hash_absent.json"
    );
    await verifierAllianceTest(verifierAllianceTestMetadataHashAbsent);
  });

  it("Store partial match in database", async () => {
    const verifierAllianceTestPartialMatch = await import(
      "../verifier-alliance/partial_match.json"
    );
    await verifierAllianceTest(verifierAllianceTestPartialMatch);
  });

  it("Store match deployed with constructor arguments in database", async () => {
    const verifierAllianceTestConstructorArguments = await import(
      "../verifier-alliance/constructor_arguments.json"
    );
    await verifierAllianceTest(verifierAllianceTestConstructorArguments);
  });

  it("Store partial match in database for a contract with multiple auxdatas", async () => {
    const verifierAllianceTestDoubleAuxdata = await import(
      "../verifier-alliance/partial_match_double_auxdata.json"
    );
    await verifierAllianceTest(verifierAllianceTestDoubleAuxdata);
  });

  it("Store full match in database for a contract with multiple auxdatas", async () => {
    const verifierAllianceTestDoubleAuxdata = await import(
      "../verifier-alliance/full_match_double_auxdata.json"
    );
    await verifierAllianceTest(verifierAllianceTestDoubleAuxdata);
  });

  // Tests to be implemented:
  // - genesis: right now not supported,
  // - partial_match_2: I don't know why we have this test

  describe("Vyper", () => {
    it("should store auxdata for a Vyper contract compiled with 0.3.4", async () => {
      const vyperTestAuxdata0_3_4 = await import(
        "../verifier-alliance/vyper/auxdata-0.3.4.json"
      );
      await verifierAllianceTestVyper(vyperTestAuxdata0_3_4);
    });

    it("should store auxdata for a Vyper contract compiled with 0.3.8", async () => {
      const vyperTestAuxdata0_3_8 = await import(
        "../verifier-alliance/vyper/auxdata-0.3.8.json"
      );
      await verifierAllianceTestVyper(vyperTestAuxdata0_3_8);
    });

    it("should store auxdata for a Vyper contract compiled with 0.4.0", async () => {
      const vyperTestAuxdata0_4_0 = await import(
        "../verifier-alliance/vyper/auxdata-0.4.0.json"
      );
      await verifierAllianceTestVyper(vyperTestAuxdata0_4_0);
    });

    it("should store auxdata for a Vyper contract compiled with 0.4.1", async () => {
      const vyperTestAuxdata0_4_1 = await import(
        "../verifier-alliance/vyper/auxdata-0.4.1.json"
      );
      await verifierAllianceTestVyper(vyperTestAuxdata0_4_1);
    });

    it("should store transformations for constructor arguments and immutables", async () => {
      const vyperTestConstructorArgumentsAndImmutables = await import(
        "../verifier-alliance/vyper/constructor_args_immutables.json"
      );
      await verifierAllianceTestVyper(
        vyperTestConstructorArgumentsAndImmutables,
      );
    });
  });
});

describe("Sourcify database", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();

  this.afterEach(() => {
    sandbox.restore();
  });

  it("When inserting a new match, nothing should be stored if an error occurs in the middle of the sql transaction", async () => {
    // Sinon will throw an error if the function is called
    sandbox
      .stub(Database.prototype, "insertVerifiedContract")
      .throws(new Error("Simulated database error"));

    const res = await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .attach("files", chainFixture.defaultContractSource, "Storage.sol");

    // Request should fail
    chai.expect(res).to.have.status(500);

    // query the database to check that nothing was stored, in any of the tables
    const verifiedContracts = await serverFixture.sourcifyDatabase.query(
      "SELECT * FROM verified_contracts",
    );
    chai.expect(verifiedContracts.rows).to.have.length(0);
    const contractDeployments = await serverFixture.sourcifyDatabase.query(
      "SELECT * FROM contract_deployments",
    );
    chai.expect(contractDeployments.rows).to.have.length(0);
    const compiledContracts = await serverFixture.sourcifyDatabase.query(
      "SELECT * FROM compiled_contracts",
    );
    chai.expect(compiledContracts.rows).to.have.length(0);
    const sources = await serverFixture.sourcifyDatabase.query(
      "SELECT * FROM sources",
    );
    chai.expect(sources.rows).to.have.length(0);
    const code =
      await serverFixture.sourcifyDatabase.query("SELECT * FROM code");
    chai.expect(code.rows).to.have.length(0);
    const sourcifyMatches = await serverFixture.sourcifyDatabase.query(
      "SELECT * FROM sourcify_matches",
    );
    chai.expect(sourcifyMatches.rows).to.have.length(0);
  });

  it("When updating an existing match, nothing should be updated if an error occurs in the middle of the sql transaction", async () => {
    const partialMetadata = (
      await import("../testcontracts/Storage/metadataModified.json")
    ).default;
    const partialMetadataBuffer = Buffer.from(JSON.stringify(partialMetadata));

    const partialSourcePath = path.join(
      __dirname,
      "..",
      "testcontracts",
      "Storage",
      "StorageModified.sol",
    );
    const partialSourceBuffer = fs.readFileSync(partialSourcePath);

    let res = await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", partialMetadataBuffer, "metadata.json")
      .attach("files", partialSourceBuffer);
    await assertVerification(
      serverFixture,
      null,
      res,
      null,
      chainFixture.defaultContractAddress,
      chainFixture.chainId,
      "partial",
    );

    const beforeTables = [
      "verified_contracts",
      "contract_deployments",
      "contracts",
      "compiled_contracts",
      "sources",
      "code",
      "sourcify_matches",
    ];
    const beforeData: Record<string, any[]> = {};

    for (const table of beforeTables) {
      const result = await serverFixture.sourcifyDatabase.query(
        `SELECT * FROM ${table}`,
      );
      beforeData[table] = result.rows;
    }

    // Sinon will throw an error if the function is called
    sandbox
      .stub(Database.prototype, "insertVerifiedContract")
      .throws(new Error("Simulated database error"));

    res = await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .field("creatorTxHash", chainFixture.defaultContractCreatorTx)
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .attach("files", chainFixture.defaultContractSource);

    // Request should fail
    chai.expect(res).to.have.status(500);

    const afterData: Record<string, any[]> = {};

    for (const table of beforeTables) {
      const result = await serverFixture.sourcifyDatabase.query(
        `SELECT * FROM ${table}`,
      );
      afterData[table] = result.rows;
    }

    chai.expect(afterData).to.deep.equal(beforeData);
  });
});
