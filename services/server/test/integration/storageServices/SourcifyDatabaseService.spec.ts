import { use, expect } from "chai";
import { SourcifyDatabaseService } from "../../../src/server/services/storageServices/SourcifyDatabaseService";
import config from "config";
import chaiAsPromised from "chai-as-promised";
import { MockVerificationExport } from "../../helpers/mocks";
import { resetDatabase } from "../../helpers/helpers";
import sinon from "sinon";
import * as signatureUtil from "../../../src/server/services/utils/signature-util";
import type { QueryResult } from "pg";
import {
  bytesFromString,
  type Tables,
} from "../../../src/server/services/utils/database-util";
import { id as keccak256str } from "ethers";

use(chaiAsPromised);

describe("SourcifyDatabaseService", function () {
  let databaseService: SourcifyDatabaseService;
  const sandbox = sinon.createSandbox();

  before(async () => {
    process.env.SOURCIFY_POSTGRES_PORT =
      process.env.DOCKER_HOST_POSTGRES_TEST_PORT || "5431";
    if (
      !process.env.SOURCIFY_POSTGRES_HOST ||
      !process.env.SOURCIFY_POSTGRES_DB ||
      !process.env.SOURCIFY_POSTGRES_USER ||
      !process.env.SOURCIFY_POSTGRES_PASSWORD ||
      !process.env.SOURCIFY_POSTGRES_PORT
    ) {
      throw new Error("Not all required environment variables set");
    }

    databaseService = new SourcifyDatabaseService(
      {
        postgres: {
          host: process.env.SOURCIFY_POSTGRES_HOST as string,
          database: process.env.SOURCIFY_POSTGRES_DB as string,
          user: process.env.SOURCIFY_POSTGRES_USER as string,
          password: process.env.SOURCIFY_POSTGRES_PASSWORD as string,
          port: parseInt(process.env.SOURCIFY_POSTGRES_PORT),
        },
      },
      config.get("serverUrl"),
    );
    await databaseService.init();
  });

  this.beforeEach(async () => {
    await resetDatabase(databaseService.database.pool);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should throw an error if no verified_contracts row can be inserted for a verification update", async () => {
    const nonePerfectVerification = structuredClone(MockVerificationExport);
    nonePerfectVerification.status.creationMatch = "partial";

    await databaseService.init();
    await databaseService.storeVerification(nonePerfectVerification);

    await expect(databaseService.storeVerification(MockVerificationExport)).to
      .eventually.be.rejected;
  });

  it("should store signatures correctly when storeVerification is called", async () => {
    await databaseService.storeVerification(MockVerificationExport);

    const signaturesResult: QueryResult<Tables.Signatures> =
      await databaseService.database.pool.query("SELECT * FROM signatures");

    expect(signaturesResult.rowCount).to.equal(2);

    const signatures = signaturesResult.rows;
    const retrieveSignature = signatures.find(
      (s) => s.signature === "retrieve()",
    );
    const storeSignature = signatures.find(
      (s) => s.signature === "store(uint256)",
    );

    expect(retrieveSignature).to.exist;
    expect(storeSignature).to.exist;

    const expectedRetrieveSignatureHash32 = bytesFromString(
      keccak256str("retrieve()"),
    );
    const expectedStoreSignatureHash32 = bytesFromString(
      keccak256str("store(uint256)"),
    );

    expect(retrieveSignature!.signature_hash_32).to.be.instanceOf(Buffer);
    expect(retrieveSignature!.signature_hash_32.length).to.equal(32);
    expect(
      retrieveSignature!.signature_hash_32.equals(
        expectedRetrieveSignatureHash32,
      ),
    ).to.be.true;
    expect(retrieveSignature!.signature_hash_4).to.be.instanceOf(Buffer);
    expect(retrieveSignature!.signature_hash_4.length).to.equal(4);
    expect(retrieveSignature!.signature_hash_4).to.deep.equal(
      expectedRetrieveSignatureHash32.subarray(0, 4),
    );

    expect(storeSignature!.signature_hash_32).to.be.instanceOf(Buffer);
    expect(storeSignature!.signature_hash_32.length).to.equal(32);
    expect(
      storeSignature!.signature_hash_32.equals(expectedStoreSignatureHash32),
    ).to.be.true;
    expect(storeSignature!.signature_hash_4).to.be.instanceOf(Buffer);
    expect(storeSignature!.signature_hash_4.length).to.equal(4);
    expect(storeSignature!.signature_hash_4).to.deep.equal(
      expectedStoreSignatureHash32.subarray(0, 4),
    );

    const compiledContractSignaturesResult: QueryResult<Tables.CompiledContractsSignatures> =
      await databaseService.database.pool.query(
        "SELECT * FROM compiled_contracts_signatures",
      );

    expect(compiledContractSignaturesResult.rowCount).to.equal(2);

    const contractSignatures = compiledContractSignaturesResult.rows;
    const compiledContractRetrieveSig =
      compiledContractSignaturesResult.rows.find((csig) =>
        csig.signature_hash_32.equals(expectedRetrieveSignatureHash32),
      );
    const compiledContractStoreSig = contractSignatures.find((csig) =>
      csig.signature_hash_32.equals(expectedStoreSignatureHash32),
    );

    expect(compiledContractRetrieveSig).to.exist;
    expect(compiledContractStoreSig).to.exist;
    expect(compiledContractRetrieveSig!.compilation_id).to.equal(
      compiledContractStoreSig!.compilation_id,
    );
    expect(compiledContractRetrieveSig!.signature_type).to.equal("function");
    expect(compiledContractStoreSig!.signature_type).to.equal("function");
  });

  it("should handle duplicate signature storage gracefully", async () => {
    // Change mock to be able to store the verification twice
    const modifiedVerification = structuredClone(MockVerificationExport);
    modifiedVerification.status.creationMatch = "partial";
    modifiedVerification.compilation.language = "Vyper";

    await databaseService.storeVerification(modifiedVerification);
    await expect(databaseService.storeVerification(MockVerificationExport)).to
      .not.be.rejected;

    const signaturesResult = await databaseService.database.pool.query(
      "SELECT COUNT(*) as count FROM signatures",
    );
    expect(parseInt(signaturesResult.rows[0].count)).to.equal(2);
  });

  it("should still store verification even if signature storage fails", async () => {
    sandbox
      .stub(signatureUtil, "extractSignaturesFromAbi")
      .throws(new Error("Simulated signature extraction error"));

    await expect(databaseService.storeVerification(MockVerificationExport)).to
      .not.be.rejected;

    const verifiedContractsResult = await databaseService.database.pool.query(
      "SELECT COUNT(*) FROM verified_contracts",
    );
    expect(parseInt(verifiedContractsResult.rows[0].count)).to.equal(1);

    const signaturesResult = await databaseService.database.pool.query(
      "SELECT COUNT(*) as count FROM signatures",
    );
    expect(parseInt(signaturesResult.rows[0].count)).to.equal(0);

    const contractSignaturesResult = await databaseService.database.pool.query(
      "SELECT COUNT(*) as count FROM compiled_contracts_signatures",
    );
    expect(parseInt(contractSignaturesResult.rows[0].count)).to.equal(0);
  });
});
