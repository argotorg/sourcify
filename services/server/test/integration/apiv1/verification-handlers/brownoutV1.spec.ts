import express from "express";
import chai from "chai";
import chaiHttp from "chai-http";
import sinon from "sinon";
import apiV1Routes from "../../../../src/server/apiv1/routes";
import type { BrownoutV1Config } from "../../../../src/server/middleware/brownoutV1";

chai.use(chaiHttp);
const { expect } = chai;

describe("brownoutV1 integration – POST /verify through real Express routes", () => {
  let app: express.Application;
  let clock: sinon.SinonFakeTimers;

  const brownoutConfig: BrownoutV1Config = {
    enabled: true,
    windows: [{ start: "2026-06-01T14:00:00Z", end: "2026-06-01T16:00:00Z" }],
  };

  before(() => {
    app = express();
    app.use(express.json());
    app.use("/", apiV1Routes);
  });

  afterEach(() => {
    if (clock) clock.restore();
  });

  it("returns 503 during a brownout window", async () => {
    clock = sinon.useFakeTimers({
      now: new Date("2026-06-01T15:00:00Z").getTime(),
      toFake: ["Date"],
    });
    app.set("brownoutV1", brownoutConfig);

    const res = await chai.request(app).post("/verify");
    expect(res).to.have.status(503);
    expect(res.body.error).to.equal("Service Unavailable - API v1 Brownout");
    expect(res).to.have.header("retry-after");
    expect(res).to.have.header("deprecation", "true");
  });

  it("passes through outside a brownout window", async () => {
    clock = sinon.useFakeTimers({
      now: new Date("2026-06-01T12:00:00Z").getTime(),
      toFake: ["Date"],
    });
    app.set("brownoutV1", brownoutConfig);

    const res = await chai.request(app).post("/verify");
    expect(res).to.not.have.status(503);
  });
});
