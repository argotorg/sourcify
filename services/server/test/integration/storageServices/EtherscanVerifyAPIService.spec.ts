import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import {
  EtherscanVerifyApiService,
  type EtherscanVerifyAPIIdentifiers,
  type EtherscanVerifyApiServiceOptions,
} from "../../../src/server/services/storageServices/EtherscanVerifyApiService";
import { WStorageIdentifiers } from "../../../src/server/services/storageServices/identifiers";
import { MockVerificationExport } from "../../helpers/mocks";
import type { SourcifyDatabaseService } from "../../../src/server/services/storageServices/SourcifyDatabaseService";
import type { Database } from "../../../src/server/services/utils/Database";

use(chaiAsPromised);

describe("EtherscanVerifyApiService", function () {
  const sandbox = sinon.createSandbox();

  const explorers: Array<{
    label: string;
    identifier: EtherscanVerifyAPIIdentifiers;
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
    identifier: EtherscanVerifyAPIIdentifiers,
    baseUrl: string,
    upsertStub: sinon.SinonStub,
    options: Partial<EtherscanVerifyApiServiceOptions> = {},
  ): EtherscanVerifyApiService => {
    const databaseStub = {
      upsertExternalVerification: upsertStub,
    } as unknown as Database;

    const sourcifyDatabaseServiceStub = {
      database: databaseStub,
    } as unknown as SourcifyDatabaseService;

    return new EtherscanVerifyApiService(
      identifier,
      sourcifyDatabaseServiceStub,
      {
        chainApiUrls: {
          [MockVerificationExport.chainId]: baseUrl,
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
        const upsertStub = sandbox.stub().resolves();
        const service = createService(identifier, baseUrl, upsertStub);
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
          `${baseUrl}?module=contract&action=verifysourcecode`,
        );

        expect(requestInit).to.be.an("object");
        const init = requestInit as RequestInit;
        expect(init.method).to.equal("POST");
        expect(
          (init.headers as Record<string, string>)["Content-Type"],
        ).to.equal("application/x-www-form-urlencoded");
        expect(init.body).to.be.a("string");

        const body = init.body as string;
        expect(body).to.include("codeformat=solidity-standard-json-input");
        expect(body).to.include(
          `contractaddress=${encodeURIComponent(verification.address)}`,
        );
        expect(body).to.include("constructorArguements=");

        sinon.assert.calledOnceWithExactly(
          upsertStub,
          jobData.verificationId,
          identifier,
          {
            verificationId: fetchPayload.result,
          },
        );
      });

      it("throws when explorer does not confirm submission", async () => {
        const upsertStub = sandbox.stub().resolves();
        const service = createService(identifier, baseUrl, upsertStub);
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
          upsertStub,
          jobData.verificationId,
          identifier,
          {
            error: fetchPayload.result,
          },
        );
      });
    });
  });

  it("uses vyper codeformat when verification is for a Vyper contract", async () => {
    const baseUrl = "https://etherscan.example/api";
    const upsertStub = sandbox.stub().resolves();
    const service = createService(
      WStorageIdentifiers.EtherscanVerify,
      baseUrl,
      upsertStub,
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
    const body = (requestInit as RequestInit).body as string;
    expect(body).to.include("codeformat=vyper-standard-json-input");
  });
});
