import chai from "chai";
import chaiHttp from "chai-http";
import { id as keccak256str } from "ethers";
import { FourByteServerFixture } from "../helpers/FourByteServerFixture";

chai.use(chaiHttp);
const { expect } = chai;

describe("Brownout of the openchain.xyz host", function () {
  const window = { start: "2020-01-01T00:00:00Z", end: "2100-01-01T00:00:00Z" };
  const serverFixture = new FourByteServerFixture({
    port: 4447,
    brownout: { "api.openchain.xyz": [window] },
  });
  const hash4 = keccak256str("transfer(address,uint256)").slice(0, 10);

  function lookup() {
    return chai
      .request(`http://localhost:${serverFixture.port}`)
      .get("/signature-database/v1/lookup")
      .query({ function: hash4 });
  }

  it("returns 503 on the deprecated host during a window", async function () {
    const res = await lookup().set("Host", "api.openchain.xyz");
    expect(res).to.have.status(503);
    expect(res.body.brownout.currentWindow).to.deep.equal(window);
    expect(res).to.have.header("retry-after");
    expect(res).to.have.header("access-control-allow-origin", "*");
  });

  it("serves other hosts during a window", async function () {
    const res = await lookup();
    expect(res).to.have.status(200);
    expect(res.body.result.function[hash4]).to.be.an("array");
    expect(res).to.not.have.header("deprecation");
  });
});
