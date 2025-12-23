import { use, expect } from "chai";
import { AllianceDatabaseService } from "../../../src/server/services/storageServices/AllianceDatabaseService";
import chaiAsPromised from "chai-as-promised";
import { MockVerificationExport } from "../../helpers/mocks";
import { resetDatabase } from "../../helpers/helpers";
import sinon from "sinon";
import { ConflictError } from "../../../src/common/errors/ConflictError";

use(chaiAsPromised);

describe("AllianceDatabaseService", function () {
  let databaseService: AllianceDatabaseService;
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

    databaseService = new AllianceDatabaseService({
      postgres: {
        host: process.env.SOURCIFY_POSTGRES_HOST as string,
        database: process.env.SOURCIFY_POSTGRES_DB as string,
        user: process.env.SOURCIFY_POSTGRES_USER as string,
        password: process.env.SOURCIFY_POSTGRES_PASSWORD as string,
        port: parseInt(process.env.SOURCIFY_POSTGRES_PORT),
      },
    });
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

    // We cannot use to.eventually.be.rejectedWith because ConflictError doesn't extend Error directly
    let thrownError: unknown;
    try {
      await databaseService.storeVerification(MockVerificationExport);
      expect.fail("Expected storeVerification to throw");
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).to.be.instanceOf(ConflictError);
    expect((thrownError as ConflictError).statusCode).to.equal(409);
    expect((thrownError as ConflictError).message).to.equal(
      "A verified contract already exist for your compilation and deployment",
    );
  });
});
