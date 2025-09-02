import chai from "chai";
import chaiHttp from "chai-http";
import { ServerFixture } from "../helpers/ServerFixture";

chai.use(chaiHttp);

describe("Verify server status endpoint", function () {
  const serverFixture = new ServerFixture();

  it("should check server's health", async function () {
    const res = await chai.request(serverFixture.server.app).get("/health");
    chai.expect(res.text).equals("Alive and kicking!");
  });
  it("should check server's chains", async function () {
    const res = await chai.request(serverFixture.server.app).get("/chains");
    chai.expect(res.body.length).greaterThan(0);
  });
});
