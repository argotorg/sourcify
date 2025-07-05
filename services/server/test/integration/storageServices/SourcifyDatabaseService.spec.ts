import { use, expect } from "chai";
import { SourcifyDatabaseService } from "../../../src/server/services/storageServices/SourcifyDatabaseService";
import config from "config";
import chaiAsPromised from "chai-as-promised";
import { MockVerificationExport } from "../../helpers/mocks";

use(chaiAsPromised);

describe("SourcifyDatabaseService", function () {
  let databaseService: SourcifyDatabaseService;

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
  });

  it("should throw an error if no verified_contracts row can be inserted for a verification update", async () => {
    const nonePerfectVerification = structuredClone(MockVerificationExport);
    nonePerfectVerification.status.creationMatch = "partial";

    await databaseService.storeVerification(nonePerfectVerification);

    await expect(databaseService.storeVerification(MockVerificationExport)).to
      .eventually.be.rejected;
  });
});
