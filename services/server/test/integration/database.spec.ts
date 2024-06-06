import chai from "chai";
import chaiHttp from "chai-http";
import { deployFromAbiAndBytecodeForCreatorTxHash } from "../helpers/helpers";
import { id as keccak256str, keccak256 } from "ethers";
import { LocalChainFixture } from "../helpers/LocalChainFixture";
import { ServerFixture } from "../helpers/ServerFixture";
import type {
  CompilerOutput,
  Match,
  Metadata,
  MetadataSourceMap,
} from "@ethereum-sourcify/lib-sourcify";
import { createCheckedContract } from "../../src/server/controllers/verification/verification.common";
import _checkedContract from "../testcontracts/Database/CheckedContract.json";
import match from "../testcontracts/Database/Match.json";

chai.use(chaiHttp);

function toHexString(byteArray: number[]) {
  return Array.from(byteArray, function (byte) {
    return ("0" + (byte & 0xff).toString(16)).slice(-2);
  }).join("");
}

describe("Verifier Alliance database", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();

  const verifierAllianceTest = async (
    testCase: any,
    { deployWithConstructorArguments } = {
      deployWithConstructorArguments: false,
    }
  ) => {
    let address: string;
    let txHash: string;
    let blockNumber: number | null;
    let txIndex: number | undefined;
    if (!deployWithConstructorArguments) {
      const {
        contractAddress,
        txHash: txCreationHash,
        blockNumber: blockNumber_,
        txIndex: txIndex_,
      } = await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        testCase.compilation_artifacts.abi,
        testCase.deployed_creation_code
      );
      address = contractAddress;
      txHash = txCreationHash;
      blockNumber = blockNumber_;
      txIndex = txIndex_;
    } else {
      const {
        contractAddress,
        txHash: txCreationHash,
        blockNumber: blockNumber_,
        txIndex: txIndex_,
      } = await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        testCase.compilation_artifacts.abi,
        testCase.compiled_creation_code,
        [testCase.creation_values.constructorArguments]
      );
      address = contractAddress;
      txHash = txCreationHash;
      blockNumber = blockNumber_;
      txIndex = txIndex_;
    }

    const compilationTarget: Record<string, string> = {};
    const fullyQualifiedName: string[] =
      testCase.fully_qualified_name.split(":");
    compilationTarget[fullyQualifiedName[0]] = fullyQualifiedName[1];
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
            testCase.compiler_settings.libraries[contractPath]
          ).forEach((contractName) => {
            libraries[`${contractPath}:${contractName}`] =
              testCase.compiler_settings.libraries[contractPath][contractName];
          });

          return libraries;
        },
        {}
      ),
    };
    await chai
      .request(serverFixture.server.app)
      .post("/")
      .send({
        address: address,
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
    if (!serverFixture.storageService.sourcifyDatabase) {
      chai.assert.fail("No database on StorageService");
    }
    await serverFixture.storageService.sourcifyDatabase.init();
    const res =
      await serverFixture.storageService.sourcifyDatabase.databasePool.query(
        `SELECT 
          compilation_artifacts,
          creation_code_artifacts,
          runtime_code_artifacts,
          creation_match,
          creation_values,
          creation_transformations,
          runtime_match,
          runtime_values,
          runtime_transformations,
          compiled_runtime_code.code as compiled_runtime_code,
          compiled_creation_code.code as compiled_creation_code,
          compiled_runtime_code.code_hash as compiled_runtime_code_hash,
          compiled_creation_code.code_hash as compiled_creation_code_hash,
          onchain_runtime_code.code as onchain_runtime_code,
          onchain_creation_code.code as onchain_creation_code,
          onchain_runtime_code.code_hash as onchain_runtime_code_hash,
          onchain_creation_code.code_hash as onchain_creation_code_hash,
          cc.compiler,
          cc.version,
          cc.language,
          cc.name,
          cc.fully_qualified_name,
          cc.sources,
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
        [Buffer.from(address.substring(2), "hex")]
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
    chai.expect(row.sources).to.deep.equal(testCase.sources);
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
        Buffer.from(chainFixture.localSigner.address.substring(2), "hex")
      );

    chai
      .expect(row.transaction_hash)
      .to.deep.equal(Buffer.from(txHash.substring(2), "hex"));

    chai.expect(parseInt(row.block_number)).to.equal(blockNumber);
    chai.expect(parseInt(row.transaction_index)).to.equal(txIndex);

    ///
    chai
      .expect(row.compilation_artifacts)
      .to.deep.equal(testCase.compilation_artifacts);
    chai
      .expect(`0x${toHexString(row.compiled_runtime_code)}`)
      .to.equal(testCase.compiled_runtime_code);
    chai
      .expect(`0x${toHexString(row.compiled_runtime_code_hash)}`)
      .to.equal(keccak256(testCase.compiled_runtime_code));
    chai
      .expect(`0x${toHexString(row.onchain_runtime_code_hash)}`)
      .to.equal(keccak256(testCase.deployed_runtime_code));
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
      .expect(`0x${toHexString(row.compiled_creation_code_hash)}`)
      .to.equal(keccak256(testCase.compiled_creation_code));
    chai
      .expect(`0x${toHexString(row.compiled_creation_code)}`)
      .to.equal(testCase.compiled_creation_code);
    chai
      .expect(`0x${toHexString(row.onchain_creation_code_hash)}`)
      .to.equal(keccak256(testCase.deployed_creation_code));
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
  };

  it("storeMatch", async () => {
    // Prepare the CheckedContract
    const checkedContract = createCheckedContract(
      _checkedContract.metadata as Metadata,
      _checkedContract.solidity,
      _checkedContract.missing,
      _checkedContract.invalid
    );
    checkedContract.creationBytecode = _checkedContract.creationBytecode;
    checkedContract.runtimeBytecode = _checkedContract.runtimeBytecode;
    checkedContract.compilerOutput =
      _checkedContract.compilerOutput as any as CompilerOutput;
    checkedContract.creationBytecodeCborAuxdata = undefined;
    checkedContract.runtimeBytecodeCborAuxdata = undefined;

    // Call storeMatch
    await serverFixture.storageService.storeMatch(
      checkedContract,
      match as Match
    );

    if (!serverFixture.storageService.sourcifyDatabase) {
      chai.assert.fail("No database on StorageService");
    }
    const res =
      await serverFixture.storageService.sourcifyDatabase.databasePool.query(
        "SELECT * FROM sourcify_matches"
      );

    if (res.rowCount === 1) {
      chai.expect(res.rows[0].runtime_match).to.equal("partial");
    }
  });

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
    await verifierAllianceTest(verifierAllianceTestConstructorArguments, {
      deployWithConstructorArguments: true,
    });
  });

  it("Store partial match in database for a contract with multiple auxdatas", async () => {
    const verifierAllianceTestDoubleAuxdata = await import(
      "../verifier-alliance/partial_match_double_auxdata.json"
    );
    await verifierAllianceTest(verifierAllianceTestDoubleAuxdata);
  });

  // Tests to be implemented:
  // - genesis: right now not supported,
  // - partial_match_2: I don't know why we have this test
});
