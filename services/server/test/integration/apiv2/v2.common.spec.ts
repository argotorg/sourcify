import chai from "chai";
import chaiHttp from "chai-http";
import { ServerFixture } from "../../helpers/ServerFixture";
import { RWStorageIdentifiers } from "../../../src/server/services/storageServices/identifiers";

chai.use(chaiHttp);

describe("/v2 with no database configured", function () {
  const serverFixture = new ServerFixture({
    skipDatabaseReset: true,
    read: RWStorageIdentifiers.RepositoryV1,
    writeOrErr: [RWStorageIdentifiers.RepositoryV1],
  });

  it("should return a 404", async function () {
    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/contracts/1`);

    chai.expect(res.status).to.equal(404);
    chai.expect(res.body.customCode).to.equal("route_not_found");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });
});
