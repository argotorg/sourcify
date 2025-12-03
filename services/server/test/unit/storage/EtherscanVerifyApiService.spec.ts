import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import {
  EtherscanVerifyApiService,
  type EtherscanVerifyApiIdentifiers,
  type EtherscanVerifyApiServiceOptions,
} from "../../../src/server/services/storageServices/EtherscanVerifyApiService";
import { WStorageIdentifiers } from "../../../src/server/services/storageServices/identifiers";
import { MockVerificationExport } from "../../helpers/mocks";
import type { SourcifyDatabaseService } from "../../../src/server/services/storageServices/SourcifyDatabaseService";
import type { Database } from "../../../src/server/services/utils/Database";

use(chaiAsPromised);

const formDataToObject = (formData: FormData): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    result[key] = value.toString();
  }
  return result;
};

const buildExpectedStandardJsonInput = (
  verification: typeof MockVerificationExport,
): string => {
  const sources: Record<string, { content: string }> = {};
  for (const [path, content] of Object.entries(
    verification.compilation.sources,
  )) {
    sources[path] = { content };
  }

  return JSON.stringify({
    language: verification.compilation.language,
    sources,
    settings: verification.compilation.jsonInput.settings,
  });
};

describe("EtherscanVerifyApiService", function () {
  const sandbox = sinon.createSandbox();

  const explorers: Array<{
    label: string;
    identifier: EtherscanVerifyApiIdentifiers;
    baseUrl: string;
  }> = [
    {
      label: "Etherscan",
      identifier: WStorageIdentifiers.EtherscanVerify,
      baseUrl: "https://etherscan.example/api",
    },
    {
      label: "Blockscout",
      identifier: WStorageIdentifiers.BlockscoutVerify,
      baseUrl: "https://blockscout.example/api",
    },
    {
      label: "Routescan",
      identifier: WStorageIdentifiers.RoutescanVerify,
      baseUrl: "https://routescan.example/api",
    },
  ];

  let fetchStub: sinon.SinonStub;

  const createService = (
    identifier: EtherscanVerifyApiIdentifiers,
    baseUrl: string,
    upsertExternalVerificationStub: sinon.SinonStub,
    options: Partial<EtherscanVerifyApiServiceOptions> = {},
  ): EtherscanVerifyApiService => {
    const databaseStub = {
      upsertExternalVerification: upsertExternalVerificationStub,
    } as unknown as Database;

    const sourcifyDatabaseServiceStub = {
      database: databaseStub,
    } as unknown as SourcifyDatabaseService;

    return new EtherscanVerifyApiService(
      identifier,
      sourcifyDatabaseServiceStub,
      {
        chainInformation: {
          apiUrls: {
            [MockVerificationExport.chainId]: baseUrl,
          },
        },
        ...options,
      },
    );
  };

  const mockFetchResponse = (payload: {
    status: "0" | "1";
    message: string;
    result: string;
  }): Response => {
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  };

  beforeEach(() => {
    fetchStub = sandbox.stub(globalThis, "fetch");
  });

  afterEach(() => {
    sandbox.restore();
  });

  explorers.forEach(({ label, identifier, baseUrl }) => {
    describe(`${label} explorer`, () => {
      it("stores verification when explorer returns OK", async () => {
        const upsertExternalVerificationStub = sandbox.stub().resolves();
        const service = createService(
          identifier,
          baseUrl,
          upsertExternalVerificationStub,
        );
        const jobData = {
          verificationId: "verification-job-id",
          finishTime: new Date(),
        };
        const fetchPayload = {
          status: "1" as const,
          message: "OK",
          result: "receipt-123",
        };
        fetchStub.resolves(mockFetchResponse(fetchPayload));

        const verification = structuredClone(MockVerificationExport);
        await expect(service.storeVerification(verification, jobData)).to
          .eventually.be.fulfilled;

        sinon.assert.calledOnce(fetchStub);
        const [requestUrl, requestInit] = fetchStub.firstCall.args;
        expect(requestUrl).to.equal(
          `${baseUrl}?module=contract&action=verifysourcecode&chainid=${verification.chainId}`,
        );

        expect(requestInit).to.be.an("object");
        const init = requestInit as RequestInit;
        expect(init.method).to.equal("POST");
        expect(init.body).to.be.instanceOf(FormData);

        const body = init.body as FormData;
        const formData = formDataToObject(body);
        const expectedSourceCode = buildExpectedStandardJsonInput(verification);
        expect(formData).to.deep.equal({
          codeformat: "solidity-standard-json-input",
          sourceCode: expectedSourceCode,
          contractaddress: verification.address,
          contractname: `${verification.compilation.compilationTarget?.path}:${verification.compilation.compilationTarget?.name}`,
          compilerversion: `v${verification.compilation.compilerVersion}`,
          constructorArguements: "",
        });

        sinon.assert.calledOnceWithExactly(
          upsertExternalVerificationStub,
          jobData.verificationId,
          identifier,
          {
            verificationId: fetchPayload.result,
          },
        );
      });

      it("throws when explorer does not confirm submission", async () => {
        const upsertExternalVerificationStub = sandbox.stub().resolves();
        const service = createService(
          identifier,
          baseUrl,
          upsertExternalVerificationStub,
        );
        const jobData = {
          verificationId: "verification-job-id",
          finishTime: new Date(),
        };
        const fetchPayload = {
          status: "0" as const,
          message: "NOTOK",
          result: "Explorer rejected submission",
        };
        fetchStub.resolves(mockFetchResponse(fetchPayload));

        await expect(
          service.storeVerification(
            structuredClone(MockVerificationExport),
            jobData,
          ),
        ).to.eventually.be.fulfilled;
        sinon.assert.calledOnceWithExactly(
          upsertExternalVerificationStub,
          jobData.verificationId,
          identifier,
          {
            error: fetchPayload.result,
          },
        );
      });
    });
  });

  it.only("waits for pending external verification writes on close", async () => {
    const baseUrl = "https://etherscan.example/api";
    // Keep the upsert promise unresolved until we manually resolve it to verify that close() waits
    let resolveUpsertExternalVerification: (() => void) | undefined;
    const upsertExternalVerificationStub = sandbox.stub().returns(
      new Promise<void>((resolve) => {
        resolveUpsertExternalVerification = resolve;
      }),
    );
    const service = createService(
      WStorageIdentifiers.EtherscanVerify,
      baseUrl,
      upsertExternalVerificationStub,
    );
    const jobData = {
      verificationId: "verification-job-id",
      finishTime: new Date(),
    };
    const fetchPayload = {
      status: "1" as const,
      message: "OK",
      result: "receipt-123",
    };
    fetchStub.resolves(mockFetchResponse(fetchPayload));

    await service.storeVerification(
      structuredClone(MockVerificationExport),
      jobData,
    );

    // Ensure the upsertExternalVerification was called and is pending
    sinon.assert.calledOnce(upsertExternalVerificationStub);

    // Ensure close() does not resolve until the pending upsertExternalVerification finishes
    const closePromise = service.close().then(() => "closed");
    const raceResult = await Promise.race([
      closePromise,
      Promise.resolve("pending"),
    ]);
    expect(raceResult).to.equal("pending");

    // Resolve the upsert and verify close() completes
    resolveUpsertExternalVerification?.();

    // Now closePromise should resolve
    const closeResult = await closePromise;
    expect(closeResult).to.equal("closed");
  });

  it("uses vyper codeformat when verification is for a Vyper contract", async () => {
    const baseUrl = "https://etherscan.example/api";
    const upsertExternalVerificationStub = sandbox.stub().resolves();
    const service = createService(
      WStorageIdentifiers.EtherscanVerify,
      baseUrl,
      upsertExternalVerificationStub,
    );
    const jobData = {
      verificationId: "verification-job-id",
      finishTime: new Date(),
    };

    const vyperVerification = structuredClone(MockVerificationExport);
    vyperVerification.compilation.language = "Vyper";
    vyperVerification.compilation.compilerVersion = "0.3.10";
    vyperVerification.compilation.metadata = {
      ...(vyperVerification.compilation.metadata || {}),
      compiler: {
        ...(vyperVerification.compilation.metadata?.compiler || {}),
        version: "0.3.10",
      },
    } as typeof vyperVerification.compilation.metadata;

    const fetchPayload = {
      status: "1" as const,
      message: "OK",
      result: "receipt-456",
    };
    fetchStub.resolves(mockFetchResponse(fetchPayload));

    await expect(service.storeVerification(vyperVerification, jobData)).to
      .eventually.be.fulfilled;

    const [, requestInit] = fetchStub.firstCall.args;
    const body = (requestInit as RequestInit).body as FormData;
    const formData = formDataToObject(body);
    const expectedSourceCode =
      buildExpectedStandardJsonInput(vyperVerification);
    expect(formData).to.deep.equal({
      codeformat: "vyper-standard-json-input",
      sourceCode: expectedSourceCode,
      contractaddress: vyperVerification.address,
      contractname: `${vyperVerification.compilation.compilationTarget?.path}:${vyperVerification.compilation.compilationTarget?.name}`,
      compilerversion: "vyper:0.3.10",
      constructorArguements: "",
      optimizationUsed: "0",
    });
  });

  it("uses the Blockscout specific endpoint and payload for Vyper verification", async () => {
    const baseUrl = "https://blockscout.example/api";
    const upsertExternalVerificationStub = sandbox.stub().resolves();
    const service = createService(
      WStorageIdentifiers.BlockscoutVerify,
      baseUrl,
      upsertExternalVerificationStub,
    );
    const jobData = {
      verificationId: "verification-job-id",
      finishTime: new Date(),
    };

    const vyperVerification = structuredClone(MockVerificationExport);
    vyperVerification.compilation.language = "Vyper";
    vyperVerification.compilation.compilerVersion = "0.3.10";
    vyperVerification.compilation.metadata = {
      ...(vyperVerification.compilation.metadata || {}),
      compiler: {
        ...(vyperVerification.compilation.metadata?.compiler || {}),
        version: "0.3.10",
      },
    } as typeof vyperVerification.compilation.metadata;

    const fetchPayload = {
      message: "Smart-contract verification started",
    };
    fetchStub.resolves({
      ok: true,
      status: 200,
      json: async () => fetchPayload,
      text: async () => JSON.stringify(fetchPayload),
    } as unknown as Response);

    await expect(service.storeVerification(vyperVerification, jobData)).to
      .eventually.be.fulfilled;

    sinon.assert.calledOnce(fetchStub);
    const [requestUrl, requestInit] = fetchStub.firstCall.args;
    expect(requestUrl).to.equal(
      `${baseUrl}/v2/smart-contracts/${vyperVerification.address.toLowerCase()}/verification/via/vyper-standard-input`,
    );
    expect(requestInit).to.be.an("object");

    const init = requestInit as RequestInit;
    expect(init.method).to.equal("POST");
    expect(init.body).to.be.instanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get("compiler_version")).to.equal("v0.3.10");
    expect(body.get("license_type")).to.equal("");
    expect(body.get("evm_version")).to.equal(
      vyperVerification.compilation.jsonInput.settings.evmVersion,
    );

    const file = body.get("files[0]") as Blob | null;
    expect(file).to.be.instanceOf(Blob);
    if (!file) {
      throw new Error("Expected files[0] FormData entry to be defined");
    }
    const fileContents = await file.text();
    const expectedSourceCode =
      buildExpectedStandardJsonInput(vyperVerification);
    expect(fileContents).to.equal(expectedSourceCode);

    expect(file.type).to.equal("application/json");

    sinon.assert.calledOnceWithExactly(
      upsertExternalVerificationStub,
      jobData.verificationId,
      WStorageIdentifiers.BlockscoutVerify,
      {
        verificationId: "BLOCKSCOUT_VYPER_SUBMITTED",
      },
    );
  });
});
