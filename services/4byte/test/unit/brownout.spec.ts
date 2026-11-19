import chai from "chai";
import chaiHttp from "chai-http";
import cors from "cors";
import express from "express";
import {
  createBrownoutMiddleware,
  getActiveBrownoutWindow,
} from "../../src/api/brownout";
import type { BrownoutConfig } from "../../src/api/brownout";
import { brownoutSchedule } from "../../src/brownoutSchedule";

chai.use(chaiHttp);
const { expect } = chai;

const window = { start: "2026-06-01T14:00:00Z", end: "2026-06-01T16:00:00Z" };
const inside = new Date("2026-06-01T15:00:00Z").getTime();
const outside = new Date("2026-06-01T12:00:00Z").getTime();

describe("brownout", () => {
  describe("getActiveBrownoutWindow", () => {
    it("returns null when no windows are configured", () => {
      expect(getActiveBrownoutWindow([], inside)).to.be.null;
    });

    it("returns null outside all windows", () => {
      expect(getActiveBrownoutWindow([window], outside)).to.be.null;
    });

    it("returns the active window", () => {
      const other = {
        start: "2026-06-02T10:00:00Z",
        end: "2026-06-02T12:00:00Z",
      };
      expect(getActiveBrownoutWindow([other, window], inside)).to.deep.equal(
        window,
      );
    });

    it("includes the start time and excludes the end time", () => {
      const start = new Date(window.start).getTime();
      const end = new Date(window.end).getTime();
      expect(getActiveBrownoutWindow([window], start)).to.deep.equal(window);
      expect(getActiveBrownoutWindow([window], end)).to.be.null;
    });
  });

  describe("createBrownoutMiddleware", () => {
    const config: BrownoutConfig = { "api.openchain.xyz": [window] };

    function createApp(now: number) {
      const app = express();
      app.use(cors());
      app.use(createBrownoutMiddleware(config, () => now));
      app.get("/signature-database/v1/lookup", (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    }

    function lookup(now: number, host: string) {
      return chai
        .request(createApp(now))
        .get("/signature-database/v1/lookup")
        .set("Host", host);
    }

    it("returns 503 for the deprecated host during a window", async () => {
      const res = await lookup(inside, "api.openchain.xyz");
      expect(res).to.have.status(503);
      expect(res.body.error).to.equal(
        "Service Unavailable - api.openchain.xyz Brownout",
      );
      expect(res.body.message).to.include("https://api.4byte.sourcify.dev");
      expect(res.body.brownout.currentWindow).to.deep.equal(window);
      expect(res).to.have.header(
        "retry-after",
        new Date(window.end).toUTCString(),
      );
      expect(res).to.have.header("deprecation", "true");
      expect(res).to.have.header("warning");
      expect(res).to.have.header("cache-control", "no-store");
      expect(res).to.have.header("access-control-allow-origin", "*");
    });

    it("ignores the case and the port of the host", async () => {
      const res = await lookup(inside, "API.OpenChain.xyz:443");
      expect(res).to.have.status(503);
    });

    it("passes the deprecated host outside a window, with deprecation headers", async () => {
      const res = await lookup(outside, "api.openchain.xyz");
      expect(res).to.have.status(200);
      expect(res).to.have.header("deprecation", "true");
      expect(res).to.have.header("warning");
      expect(res).to.not.have.header("retry-after");
    });

    it("passes other hosts during a window, without deprecation headers", async () => {
      const res = await lookup(inside, "api.4byte.sourcify.dev");
      expect(res).to.have.status(200);
      expect(res).to.not.have.header("deprecation");
    });

    it("answers a preflight request during a window", async () => {
      const res = await chai
        .request(createApp(inside))
        .options("/signature-database/v1/lookup")
        .set("Host", "api.openchain.xyz")
        .set("Origin", "https://explorer.example")
        .set("Access-Control-Request-Method", "GET");
      expect(res).to.have.status(204);
    });
  });

  describe("brownoutSchedule", () => {
    it("has valid windows in ascending order for each host", () => {
      for (const windows of Object.values(brownoutSchedule)) {
        let previousEnd = 0;
        for (const { start, end } of windows) {
          const startMs = new Date(start).getTime();
          const endMs = new Date(end).getTime();
          expect(startMs, start).to.be.a("number").and.not.NaN;
          expect(endMs, end).to.be.greaterThan(startMs);
          expect(startMs, start).to.be.at.least(previousEnd);
          previousEnd = endMs;
        }
      }
    });

    it("uses lower case host names", () => {
      for (const host of Object.keys(brownoutSchedule)) {
        expect(host).to.equal(host.toLowerCase());
      }
    });
  });
});
