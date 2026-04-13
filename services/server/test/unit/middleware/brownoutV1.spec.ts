import type { Request, Response } from "express";
import { expect } from "chai";
import * as sinon from "sinon";
import {
  getActiveBrownoutV1Window,
  createBrownoutV1Middleware,
} from "../../../src/server/middleware/brownoutV1";
import type { BrownoutV1Config } from "../../../src/server/middleware/brownoutV1";

describe("brownoutV1 middleware", () => {
  let clock: sinon.SinonFakeTimers;

  afterEach(() => {
    if (clock) clock.restore();
  });

  describe("getActiveBrownoutV1Window", () => {
    it("returns null when no windows are configured", () => {
      const config: BrownoutV1Config = { enabled: true, windows: [] };
      expect(getActiveBrownoutV1Window(config)).to.be.null;
    });

    it("returns null when current time is outside all windows", () => {
      clock = sinon.useFakeTimers(new Date("2026-06-01T12:00:00Z").getTime());
      const config: BrownoutV1Config = {
        enabled: true,
        windows: [
          { start: "2026-06-01T14:00:00Z", end: "2026-06-01T16:00:00Z" },
        ],
      };
      expect(getActiveBrownoutV1Window(config)).to.be.null;
    });

    it("returns the active window when current time is inside", () => {
      clock = sinon.useFakeTimers(new Date("2026-06-01T15:00:00Z").getTime());
      const window = {
        start: "2026-06-01T14:00:00Z",
        end: "2026-06-01T16:00:00Z",
      };
      const config: BrownoutV1Config = {
        enabled: true,
        windows: [window],
      };
      expect(getActiveBrownoutV1Window(config)).to.deep.equal(window);
    });

    it("returns the correct window when multiple are configured", () => {
      clock = sinon.useFakeTimers(new Date("2026-06-02T10:30:00Z").getTime());
      const window1 = {
        start: "2026-06-01T14:00:00Z",
        end: "2026-06-01T16:00:00Z",
      };
      const window2 = {
        start: "2026-06-02T10:00:00Z",
        end: "2026-06-02T12:00:00Z",
      };
      const config: BrownoutV1Config = {
        enabled: true,
        windows: [window1, window2],
      };
      expect(getActiveBrownoutV1Window(config)).to.deep.equal(window2);
    });

    it("excludes the end time (half-open interval)", () => {
      clock = sinon.useFakeTimers(new Date("2026-06-01T16:00:00Z").getTime());
      const config: BrownoutV1Config = {
        enabled: true,
        windows: [
          { start: "2026-06-01T14:00:00Z", end: "2026-06-01T16:00:00Z" },
        ],
      };
      expect(getActiveBrownoutV1Window(config)).to.be.null;
    });
  });

  describe("createBrownoutV1Middleware", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: sinon.SinonSpy;
    let jsonSpy: sinon.SinonSpy;
    let statusStub: sinon.SinonStub;
    let setHeaderSpy: sinon.SinonSpy;

    beforeEach(() => {
      jsonSpy = sinon.spy();
      setHeaderSpy = sinon.spy();
      statusStub = sinon.stub().returns({ json: jsonSpy });
      req = {
        path: "/verify",
        method: "POST",
        originalUrl: "/verify",
        app: {
          get: sinon.stub(),
        } as any,
      };
      res = {
        status: statusStub,
        setHeader: setHeaderSpy,
      };
      next = sinon.spy();
    });

    it("calls next when config is undefined", () => {
      (req.app!.get as sinon.SinonStub).returns(undefined);
      const middleware = createBrownoutV1Middleware();
      middleware(req as Request, res as Response, next);
      expect(next.calledOnce).to.be.true;
      expect(statusStub.called).to.be.false;
    });

    it("calls next when brownout is disabled", () => {
      (req.app!.get as sinon.SinonStub).returns({
        enabled: false,
        windows: [
          { start: "2026-06-01T00:00:00Z", end: "2026-12-31T23:59:59Z" },
        ],
      });
      const middleware = createBrownoutV1Middleware();
      middleware(req as Request, res as Response, next);
      expect(next.calledOnce).to.be.true;
    });

    it("calls next when outside brownout window", () => {
      clock = sinon.useFakeTimers(new Date("2026-06-01T12:00:00Z").getTime());
      (req.app!.get as sinon.SinonStub).returns({
        enabled: true,
        windows: [
          { start: "2026-06-01T14:00:00Z", end: "2026-06-01T16:00:00Z" },
        ],
      });
      const middleware = createBrownoutV1Middleware();
      middleware(req as Request, res as Response, next);
      expect(next.calledOnce).to.be.true;
    });

    it("returns 503 during brownout window", () => {
      clock = sinon.useFakeTimers(new Date("2026-06-01T15:00:00Z").getTime());
      (req.app!.get as sinon.SinonStub).returns({
        enabled: true,
        windows: [
          { start: "2026-06-01T14:00:00Z", end: "2026-06-01T16:00:00Z" },
        ],
      });
      const middleware = createBrownoutV1Middleware();
      middleware(req as Request, res as Response, next);

      expect(next.called).to.be.false;
      expect(statusStub.calledWith(503)).to.be.true;
      expect(jsonSpy.calledOnce).to.be.true;

      const body = jsonSpy.firstCall.args[0];
      expect(body.error).to.equal("Service Unavailable - API v1 Brownout");
      expect(body.message).to.include("Please migrate to API v2");
      expect(body.brownout.currentWindow.start).to.equal(
        "2026-06-01T14:00:00Z",
      );
      expect(body.brownout.currentWindow.end).to.equal("2026-06-01T16:00:00Z");
    });

    it("sets Retry-After, Deprecation, and Warning headers during brownout", () => {
      clock = sinon.useFakeTimers(new Date("2026-06-01T15:00:00Z").getTime());
      (req.app!.get as sinon.SinonStub).returns({
        enabled: true,
        windows: [
          { start: "2026-06-01T14:00:00Z", end: "2026-06-01T16:00:00Z" },
        ],
      });
      const middleware = createBrownoutV1Middleware();
      middleware(req as Request, res as Response, next);

      expect(
        setHeaderSpy.calledWith(
          "Retry-After",
          new Date("2026-06-01T16:00:00Z").toUTCString(),
        ),
      ).to.be.true;
      expect(setHeaderSpy.calledWith("Deprecation", "true")).to.be.true;
      expect(setHeaderSpy.calledWith("Warning", sinon.match.string)).to.be.true;
    });
  });
});
