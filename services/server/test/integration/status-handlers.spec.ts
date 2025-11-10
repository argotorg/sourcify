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

  it("should return version information", async function () {
    const res = await chai.request(serverFixture.server.app).get("/version");

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.have.property("sourcifyServerVersion");
    chai.expect(res.body).to.have.property("libSourcifyVersion");
    chai.expect(res.body).to.have.property("sourcifyCompilersVersion");
    chai.expect(res.body).to.have.property("bytecodeUtilsVersion");
    chai.expect(res.body).to.have.property("gitCommitHash");

    chai.expect(res.body.sourcifyServerVersion).to.be.a("string").and.not.empty;
    chai.expect(res.body.libSourcifyVersion).to.be.a("string").and.not.empty;
    chai.expect(res.body.sourcifyCompilersVersion).to.be.a("string").and.not
      .empty;
    chai.expect(res.body.bytecodeUtilsVersion).to.be.a("string").and.not.empty;
    chai.expect(res.body.gitCommitHash).to.be.a("string").and.not.empty;
  });
});
