import chai from "chai";
import { keccak256 } from "ethers";
import type { ServerFixture } from "../../helpers/ServerFixture";
import {
  bytesFromString,
  getCompilerNameFromLanguage,
} from "../../../src/server/services/utils/database-util";
import { extractSignaturesFromAbi } from "../../../src/server/services/utils/signature-util";
import crypto from "crypto";
import type {
  Bytes,
  SignatureRepresentations,
} from "../../../src/server/types";
import { splitFullyQualifiedName } from "@ethereum-sourcify/lib-sourcify";
import {
  getTotalMatchLevel,
  toVerificationStatus,
} from "../../../src/server/services/utils/util";
import type { VerificationTestCase } from "./verification-cases.spec";
import type { DeploymentInfo } from "../../helpers/helpers";

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

export async function assertDatabase(
  serverFixture: ServerFixture,
  testCase: VerificationTestCase,
  chainId: string,
  deployerAddress: string,
  deploymentInfo: DeploymentInfo,
) {
  if (!serverFixture.sourcifyDatabase) {
    chai.assert.fail("No database on StorageService");
  }
  const addressBuffer = Buffer.from(
    deploymentInfo.contractAddress.substring(2),
    "hex",
  );
  const res = await serverFixture.sourcifyDatabase.query(
    `SELECT
          vc.creation_match,
          vc.creation_values,
          vc.creation_transformations,
          vc.creation_metadata_match,
          vc.runtime_match,
          vc.runtime_values,
          vc.runtime_transformations,
          vc.runtime_metadata_match,
          sm.creation_match as sourcify_creation_match,
          sm.runtime_match as sourcify_runtime_match,
          sm.metadata,
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
          cc.compilation_artifacts,
          cc.creation_code_artifacts,
          cc.runtime_code_artifacts,
          cd.chain_id,
          cd.address,
          cd.transaction_hash,
          cd.block_number,
          cd.transaction_index,
          cd.deployer
        FROM verified_contracts vc
        JOIN sourcify_matches sm ON sm.verified_contract_id = vc.id
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
  const resSignatures = await serverFixture.sourcifyDatabase.query(
    `SELECT
          ccs.signature_type,
          s.signature,
          s.signature_hash_32
        FROM verified_contracts vc
        JOIN contract_deployments cd ON cd.id = vc.deployment_id
        JOIN compiled_contracts cc ON cc.id = vc.compilation_id
        JOIN compiled_contracts_signatures ccs on ccs.compilation_id = cc.id
        LEFT JOIN signatures s ON s.signature_hash_32 = ccs.signature_hash_32
        where cd.address = $1
        ORDER BY ccs.signature_type, s.signature`,
    [addressBuffer],
  );
  chai.expect(res.rowCount).to.equal(1);

  const row = res.rows[0];

  // compiled_contracts columns
  const { contractName } = splitFullyQualifiedName(
    testCase.input.contractIdentifier,
  );
  chai
    .expect(row.compiler)
    .to.equal(
      getCompilerNameFromLanguage(testCase.input.stdJsonInput.language),
    );
  chai.expect(row.version).to.equal(testCase.input.compilerVersion);
  chai
    .expect(row.language)
    .to.equal(testCase.input.stdJsonInput.language.toLowerCase());
  chai.expect(row.name).to.equal(contractName);
  chai
    .expect(row.fully_qualified_name)
    .to.equal(testCase.input.contractIdentifier);
  chai
    .expect(row.compiler_settings)
    .to.deep.equal(testCase.input.stdJsonInput.settings);
  chai
    .expect(row.compilation_artifacts)
    .to.deep.equal(testCase.output.compilationArtifacts);
  chai
    .expect(row.creation_code_artifacts)
    .to.deep.equal(testCase.output.creationCodeArtifacts);
  chai
    .expect(row.runtime_code_artifacts)
    .to.deep.equal(testCase.output.runtimeCodeArtifacts);

  // compiled_contracts -> code columns
  chai
    .expect(`0x${toHexString(row.compiled_creation_code)}`)
    .to.equal(testCase.output.creationBytecode);
  chai
    .expect(`0x${toHexString(row.compiled_runtime_code)}`)
    .to.equal(testCase.output.deployedBytecode);
  chai
    .expect(toHexString(row.compiled_creation_code_hash))
    .to.equal(sha3_256(bytesFromString(testCase.output.creationBytecode)));
  chai
    .expect(toHexString(row.compiled_runtime_code_hash))
    .to.equal(sha3_256(bytesFromString(testCase.output.deployedBytecode)));
  chai
    .expect(`0x${toHexString(row.compiled_creation_code_hash_keccak)}`)
    .to.equal(keccak256(bytesFromString(testCase.output.creationBytecode)));
  chai
    .expect(`0x${toHexString(row.compiled_runtime_code_hash_keccak)}`)
    .to.equal(keccak256(bytesFromString(testCase.output.deployedBytecode)));

  // sources and compiled_contracts_sources columns
  const sources = testCase.input.stdJsonInput.sources;
  const expectedSources: Record<string, string> = {};
  Object.keys(sources).forEach((path) => {
    expectedSources[path] = sources[path].content;
  });
  chai
    .expect(
      resSources.rows.reduce((sources, source) => {
        sources[source.path] = source.content;
        return sources;
      }, {}),
    )
    .to.deep.equal(expectedSources);

  // signatures and compiled_contracts_signatures columns
  if (testCase.output.compilationArtifacts.abi) {
    const expectedSignatures = extractSignaturesFromAbi(
      testCase.output.compilationArtifacts.abi,
    );
    chai.expect(resSignatures.rowCount).to.equal(expectedSignatures.length);
    const actualSignatures = resSignatures.rows.map((row) => ({
      signature: row.signature,
      signatureHash32: `0x${toHexString(row.signature_hash_32)}`,
      signatureType: row.signature_type,
    }));
    const sortSignatures = (a: any, b: any) =>
      a.signatureType.localeCompare(b.signatureType) ||
      a.signature.localeCompare(b.signature);
    chai
      .expect(actualSignatures.sort(sortSignatures))
      .to.deep.equal(expectedSignatures.sort(sortSignatures));
  } else {
    chai.expect(resSignatures.rowCount).to.equal(0);
  }

  // contract_deployments columns
  chai.expect(row.chain_id).to.equal(chainId);
  chai
    .expect(row.address)
    .to.deep.equal(
      Buffer.from(deploymentInfo.contractAddress.substring(2), "hex"),
    );
  chai
    .expect(row.transaction_hash)
    .to.deep.equal(Buffer.from(deploymentInfo.txHash.substring(2), "hex"));
  chai.expect(parseInt(row.block_number)).to.equal(deploymentInfo.blockNumber);
  chai.expect(parseInt(row.transaction_index)).to.equal(deploymentInfo.txIndex);
  chai
    .expect(row.deployer)
    .to.deep.equal(Buffer.from(deployerAddress.substring(2), "hex"));

  // contract_deployments -> code columns
  chai
    .expect(`0x${toHexString(row.onchain_creation_code)}`)
    .to.equal(testCase.onchain.creationBytecode);
  chai
    .expect(`0x${toHexString(row.onchain_runtime_code)}`)
    .to.equal(testCase.onchain.deployedBytecode);
  chai
    .expect(toHexString(row.onchain_creation_code_hash))
    .to.equal(sha3_256(bytesFromString(testCase.onchain.creationBytecode)));
  chai
    .expect(toHexString(row.onchain_runtime_code_hash))
    .to.equal(sha3_256(bytesFromString(testCase.onchain.deployedBytecode)));
  chai
    .expect(`0x${toHexString(row.onchain_creation_code_hash_keccak)}`)
    .to.equal(keccak256(bytesFromString(testCase.onchain.creationBytecode)));
  chai
    .expect(`0x${toHexString(row.onchain_runtime_code_hash_keccak)}`)
    .to.equal(keccak256(bytesFromString(testCase.onchain.deployedBytecode)));

  // verified_contracts columns
  chai
    .expect(row.creation_match)
    .to.deep.equal(testCase.verification.creationMatch !== null);
  chai
    .expect(row.creation_values)
    .to.deep.equal(testCase.verification.creationValues);
  chai
    .expect(row.creation_transformations)
    .to.deep.equal(testCase.verification.creationTransformations);
  chai
    .expect(row.creation_metadata_match)
    .to.equal(testCase.verification.creationMatch === "exact_match");
  chai
    .expect(row.runtime_match)
    .to.deep.equal(testCase.verification.runtimeMatch !== null);
  chai
    .expect(row.runtime_values)
    .to.deep.equal(testCase.verification.runtimeValues);
  chai
    .expect(row.runtime_transformations)
    .to.deep.equal(testCase.verification.runtimeTransformations);
  chai
    .expect(row.runtime_metadata_match)
    .to.equal(testCase.verification.runtimeMatch === "exact_match");

  // sourcify_matches columns
  chai
    .expect(row.sourcify_creation_match)
    .to.equal(toVerificationStatus(testCase.verification.creationMatch));
  chai
    .expect(row.sourcify_runtime_match)
    .to.equal(toVerificationStatus(testCase.verification.runtimeMatch));
  chai.expect(row.metadata).to.deep.equal(testCase.output.metadata);
}

export async function assertApiV2Lookup(
  serverFixture: ServerFixture,
  testCase: VerificationTestCase,
  chainId: string,
  deployerAddress: string,
  deploymentInfo: DeploymentInfo,
) {
  const res = await chai
    .request(serverFixture.server.app)
    .get(
      `/v2/contract/${chainId}/${deploymentInfo.contractAddress}?fields=all`,
    );

  chai.expect(res.status).to.equal(200);

  // Default fields
  chai
    .expect(res.body.match)
    .to.equal(
      getTotalMatchLevel(
        toVerificationStatus(testCase.verification.creationMatch),
        toVerificationStatus(testCase.verification.runtimeMatch),
      ),
    );
  chai
    .expect(res.body.creationMatch)
    .to.equal(testCase.verification.creationMatch);
  chai
    .expect(res.body.runtimeMatch)
    .to.equal(testCase.verification.runtimeMatch);
  chai.expect(res.body.chainId).to.equal(chainId);
  chai.expect(res.body.address).to.equal(deploymentInfo.contractAddress);

  // creationBytecode
  chai.expect(res.body).to.have.property("creationBytecode");
  chai
    .expect(res.body.creationBytecode.onchainBytecode)
    .to.equal(testCase.onchain.creationBytecode);
  chai
    .expect(res.body.creationBytecode.recompiledBytecode)
    .to.equal(testCase.output.creationBytecode);
  chai
    .expect(res.body.creationBytecode.transformations)
    .to.deep.equal(testCase.verification.creationTransformations);
  chai
    .expect(res.body.creationBytecode.transformationValues)
    .to.deep.equal(testCase.verification.creationValues);
  chai
    .expect(res.body.creationBytecode.sourceMap)
    .to.deep.equal(testCase.output.creationCodeArtifacts.sourceMap);
  chai
    .expect(res.body.creationBytecode.linkReferences)
    .to.deep.equal(testCase.output.creationCodeArtifacts.linkReferences);
  chai
    .expect(res.body.creationBytecode.cborAuxdata)
    .to.deep.equal(testCase.output.creationCodeArtifacts.cborAuxdata);

  // runtimeBytecode
  chai.expect(res.body).to.have.property("runtimeBytecode");
  chai
    .expect(res.body.runtimeBytecode.onchainBytecode)
    .to.equal(testCase.onchain.deployedBytecode);
  chai
    .expect(res.body.runtimeBytecode.recompiledBytecode)
    .to.equal(testCase.output.deployedBytecode);
  chai
    .expect(res.body.runtimeBytecode.transformations)
    .to.deep.equal(testCase.verification.runtimeTransformations);
  chai
    .expect(res.body.runtimeBytecode.transformationValues)
    .to.deep.equal(testCase.verification.runtimeValues);
  chai
    .expect(res.body.runtimeBytecode.sourceMap)
    .to.deep.equal(testCase.output.runtimeCodeArtifacts.sourceMap);
  chai
    .expect(res.body.runtimeBytecode.linkReferences)
    .to.deep.equal(testCase.output.runtimeCodeArtifacts.linkReferences);
  chai
    .expect(res.body.runtimeBytecode.cborAuxdata)
    .to.deep.equal(testCase.output.runtimeCodeArtifacts.cborAuxdata);
  chai
    .expect(res.body.runtimeBytecode.immutableReferences)
    .to.deep.equal(testCase.output.runtimeCodeArtifacts.immutableReferences);

  // deployment
  chai.expect(res.body).to.have.property("deployment");
  chai
    .expect(res.body.deployment.transactionHash)
    .to.equal(deploymentInfo.txHash);
  chai
    .expect(res.body.deployment.blockNumber)
    .to.equal(deploymentInfo.blockNumber.toString());
  chai
    .expect(res.body.deployment.transactionIndex)
    .to.equal(deploymentInfo.txIndex.toString());
  chai.expect(res.body.deployment.deployer).to.equal(deployerAddress);

  // sources
  chai
    .expect(res.body.sources)
    .to.deep.equal(testCase.input.stdJsonInput.sources);

  // compilation
  chai.expect(res.body).to.have.property("compilation");
  chai
    .expect(res.body.compilation.language)
    .to.equal(testCase.input.stdJsonInput.language);
  chai
    .expect(res.body.compilation.compiler)
    .to.equal(
      getCompilerNameFromLanguage(testCase.input.stdJsonInput.language),
    );
  chai
    .expect(res.body.compilation.compilerVersion)
    .to.equal(testCase.input.compilerVersion);
  chai
    .expect(res.body.compilation.compilerSettings)
    .to.deep.equal(testCase.input.stdJsonInput.settings);
  const { contractName } = splitFullyQualifiedName(
    testCase.input.contractIdentifier,
  );
  chai.expect(res.body.compilation.name).to.equal(contractName);
  chai
    .expect(res.body.compilation.fullyQualifiedName)
    .to.equal(testCase.input.contractIdentifier);

  // abi
  chai
    .expect(res.body.abi)
    .to.deep.equal(testCase.output.compilationArtifacts.abi);

  // metadata
  chai.expect(res.body.metadata).to.deep.equal(testCase.output.metadata);

  // storageLayout
  chai
    .expect(res.body.storageLayout)
    .to.deep.equal(testCase.output.compilationArtifacts.storageLayout);

  // userdoc
  chai
    .expect(res.body.userdoc)
    .to.deep.equal(testCase.output.compilationArtifacts.userdoc);

  // devdoc
  chai
    .expect(res.body.devdoc)
    .to.deep.equal(testCase.output.compilationArtifacts.devdoc);

  // sourceIds
  chai
    .expect(res.body.sourceIds)
    .to.deep.equal(testCase.output.compilationArtifacts.sources);

  // stdJsonInput
  chai.expect(res.body.stdJsonInput).to.deep.equal(testCase.input.stdJsonInput);

  // signatures
  chai.expect(res.body).to.have.property("signatures");
  const extractedSignatures = extractSignaturesFromAbi(
    testCase.output.compilationArtifacts.abi || [],
  );
  const expectedSignatures = extractedSignatures.reduce(
    (acc, sig) => {
      acc[sig.signatureType].push({
        signature: sig.signature,
        signatureHash32: sig.signatureHash32,
        signatureHash4: sig.signatureHash32.slice(0, 10),
      });
      return acc;
    },
    {
      function: [] as SignatureRepresentations[],
      event: [] as SignatureRepresentations[],
      error: [] as SignatureRepresentations[],
    },
  );
  const sortBySignature = (a: any, b: any) =>
    a.signature.localeCompare(b.signature);
  expectedSignatures.function.sort(sortBySignature);
  expectedSignatures.event.sort(sortBySignature);
  expectedSignatures.error.sort(sortBySignature);
  res.body.signatures.function.sort(sortBySignature);
  res.body.signatures.event.sort(sortBySignature);
  res.body.signatures.error.sort(sortBySignature);
  chai.expect(res.body.signatures).to.deep.equal(expectedSignatures);
}
