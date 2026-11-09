import http from "http";
import type { AddressInfo } from "net";
import chai from "chai";
import { FourByteServerFixture } from "../helpers/FourByteServerFixture";
import { SignatureStats } from "../../src/SignatureStats";
import { SignatureType } from "../../src/utils/signature-util";
import logger from "../../src/logger";

describe("SignatureStats with a base file", function () {
  const serverFixture = new FourByteServerFixture({ port: 4446 });

  let baseServer: http.Server;
  let baseUrl: string;
  let baseStatus = 200;
  let baseBody = "";
  let lastPath: string | undefined;

  const HOUR_MS = 60 * 60 * 1000;

  // created_at has microseconds and a JS Date has milliseconds. Wait, so that the
  // next count window ends after the rows that the test just inserted.
  const nextMillisecond = () =>
    new Promise((resolve) => setTimeout(resolve, 5));

  // The format of the BigQuery JSON export: one line, INT64 as strings
  const baseFile = (t0: Date, counts: Record<string, number>) =>
    JSON.stringify({
      t0: t0.toISOString(),
      ...Object.fromEntries(
        Object.entries(counts).map(([k, v]) => [k, String(v)]),
      ),
    }) + "\n";

  const BASE_COUNTS = {
    function: 1000,
    event: 200,
    error: 30,
    unknown: 400,
    total: 1500,
  };

  const createStats = () =>
    new SignatureStats(serverFixture.server.database, logger, {
      baseUrl,
      commitMarginMs: 0,
      countStepMs: 1,
    });

  before(async () => {
    baseServer = http.createServer((req, res) => {
      // Fake metadata server and Cloud Storage API for gs:// URLs
      if (req.url === "/token") {
        res.end(
          JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
        );
        return;
      }
      if (
        req.url?.startsWith("/storage/") &&
        req.headers.authorization !== "Bearer test-token"
      ) {
        res.statusCode = 401;
        res.end();
        return;
      }
      lastPath = req.url;
      res.statusCode = baseStatus;
      res.end(baseBody);
    });
    await new Promise<void>((resolve) => baseServer.listen(0, resolve));
    baseUrl = `http://localhost:${(baseServer.address() as AddressInfo).port}/production-000000000000.json`;
  });

  after(async () => {
    await new Promise((resolve) => baseServer.close(resolve));
  });

  beforeEach(async () => {
    baseStatus = 200;
    await serverFixture.resetDatabase();
    // Before t0: in the base file, so not in the delta
    await serverFixture.insertTestSignatures([
      { signature: "old()", type: SignatureType.Function },
    ]);
    await serverFixture.pool.query(
      "UPDATE signatures SET created_at = now() - interval '2 hours'",
    );
    // After t0: the delta
    await serverFixture.insertTestSignatures([
      { signature: "fn()", type: SignatureType.Function },
      { signature: "Ev()", type: SignatureType.Event },
      { signature: "Err()", type: SignatureType.Error },
      { signature: "both()", type: SignatureType.Function },
      { signature: "both()", type: SignatureType.Event },
      { signature: "imported()" },
    ]);
  });

  it("should add the new Postgres rows to the base", async function () {
    baseBody = baseFile(new Date(Date.now() - HOUR_MS), BASE_COUNTS);
    const stats = createStats();
    await stats.start();

    const result = await stats.getStats();
    stats.stop();

    chai.expect(result.count).to.deep.equal({
      function: 1000 + 2,
      event: 200 + 2,
      error: 30 + 1,
      unknown: 400 + 1,
      total: 1500 + 5,
    });
  });

  it("should read a gs:// file with the token of the service account", async function () {
    baseBody = baseFile(new Date(Date.now() - HOUR_MS), BASE_COUNTS);
    const origin = new URL(baseUrl).origin;
    const stats = new SignatureStats(serverFixture.server.database, logger, {
      baseUrl: "gs://stats-bucket/production-000000000000.json",
      gcsApiUrl: origin,
      metadataTokenUrl: `${origin}/token`,
      commitMarginMs: 0,
      countStepMs: 1,
    });
    await stats.start();

    const result = await stats.getStats();
    stats.stop();

    chai
      .expect(lastPath)
      .to.equal(
        "/storage/v1/b/stats-bucket/o/production-000000000000.json?alt=media",
      );
    chai.expect(result.count.function).to.equal(1000 + 2);
  });

  it("should add the new rows at each refresh", async function () {
    baseBody = baseFile(new Date(Date.now() - HOUR_MS), BASE_COUNTS);
    const stats = createStats();
    await stats.start();
    chai.expect((await stats.getStats()).count.total).to.equal(1500 + 5);

    await serverFixture.insertTestSignatures([
      { signature: "later()", type: SignatureType.Event },
      { signature: "laterImport()" },
    ]);
    await nextMillisecond();
    await stats.refresh();
    const result = await stats.getStats();
    stats.stop();
    chai.expect(result.count).to.deep.equal({
      function: 1000 + 2,
      event: 200 + 3,
      error: 30 + 1,
      unknown: 400 + 2,
      total: 1500 + 7,
    });
  });

  it("should end the count windows at a whole step", async function () {
    const now = new Date("2026-10-20T10:06:42.500Z");
    const until: Date[] = [];
    const database = {
      countSignaturesBetween: async (_after: Date, end: Date) => {
        until.push(end);
        return { function: 0, event: 0, error: 0, unknown: 0, total: 0 };
      },
    } as unknown as typeof serverFixture.server.database;
    const stats = new SignatureStats(database, logger, {
      baseUrl,
      now: () => now,
    });
    baseBody = baseFile(new Date("2026-10-20T09:00:00Z"), BASE_COUNTS);
    await stats.loadBase();
    await stats.refresh();

    // 60 s of margin, then down to the whole minute
    chai
      .expect(until.map((d) => d.toISOString()))
      .to.deep.equal(["2026-10-20T10:05:00.000Z"]);
  });

  describe("with a fake clock", function () {
    const ZERO = { function: 0, event: 0, error: 0, unknown: 0, total: 0 };
    let now: Date;
    let windows: string[];
    let baseReads: number;

    const fakeDatabase = {
      countSignaturesBetween: async (_after: Date, end: Date) => {
        windows.push(end.toISOString());
        return { ...ZERO, function: 1, total: 1 };
      },
    } as unknown as typeof serverFixture.server.database;

    // No start(): the timers do not run, as on an idle instance with a throttled CPU
    const createFakeStats = () =>
      new SignatureStats(fakeDatabase, logger, {
        baseUrl,
        now: () => now,
      });

    beforeEach(() => {
      now = new Date("2026-10-20T10:06:42.500Z");
      windows = [];
      baseReads = 0;
      baseBody = baseFile(new Date("2026-10-20T09:00:00Z"), BASE_COUNTS);
    });

    const countBaseReads = () => {
      const listener = () => baseReads++;
      baseServer.on("request", listener);
      return () => baseServer.off("request", listener);
    };

    it("should count in the request only if the counts are behind", async function () {
      const stats = createFakeStats();
      const stopCounting = countBaseReads();

      await stats.getStats();
      // Same minute: from memory
      now = new Date("2026-10-20T10:06:59.000Z");
      await stats.getStats();
      // The next minute, and no timer ran: the request counts
      now = new Date("2026-10-20T10:07:01.000Z");
      const result = await stats.getStats();
      // 10 minutes later: the request reads the base file again
      now = new Date("2026-10-20T10:17:01.000Z");
      await stats.getStats();
      stopCounting();

      chai
        .expect(windows)
        .to.deep.equal([
          "2026-10-20T10:05:00.000Z",
          "2026-10-20T10:06:00.000Z",
          "2026-10-20T10:16:00.000Z",
        ]);
      chai.expect(result.count.function).to.equal(1000 + 2);
      chai.expect(baseReads).to.equal(2);
    });

    it("should give a null breakdown when the base of the counts gets old", async function () {
      const stats = createFakeStats();
      chai.expect((await stats.getStats()).count.function).to.equal(1000 + 1);

      // The daily query stopped: the file stays the same
      now = new Date("2026-10-22T09:00:00.000Z");
      const result = await stats.getStats();

      chai.expect(result.count.function).to.equal(null);
      chai.expect(result.count.unknown).to.equal(null);
      chai.expect(result.count.total).to.equal(1500 + 2);
    });
  });

  it("should count the total only and add the new rows without a base", async function () {
    baseStatus = 404;
    const stats = createStats();
    await stats.start();
    chai.expect((await stats.getStats()).count.total).to.equal(6);

    await serverFixture.insertTestSignatures([{ signature: "later()" }]);
    await nextMillisecond();
    await stats.refresh();
    const result = await stats.getStats();
    stats.stop();
    chai.expect(result.count.total).to.equal(7);
    chai.expect(result.count.unknown).to.equal(null);
  });

  it("should give a null breakdown if t0 is 2 days old", async function () {
    baseBody = baseFile(new Date(Date.now() - 48 * HOUR_MS), BASE_COUNTS);
    const stats = createStats();
    await stats.start();

    const result = await stats.getStats();
    stats.stop();

    chai.expect(result.count.function).to.equal(null);
    chai.expect(result.count.unknown).to.equal(null);
    // A full count in Postgres
    chai.expect(result.count.total).to.equal(6);
  });

  it("should give a null breakdown if there is no file", async function () {
    baseStatus = 404;
    baseBody = "Not found";
    const stats = createStats();
    await stats.start();

    const result = await stats.getStats();
    stats.stop();

    chai.expect(result.count.event).to.equal(null);
    chai.expect(result.count.total).to.equal(6);
  });

  it("should keep the last good file if a read fails or the file is not valid", async function () {
    baseBody = baseFile(new Date(Date.now() - HOUR_MS), BASE_COUNTS);
    const stats = createStats();
    await stats.start();

    baseStatus = 500;
    await stats.loadBase();
    await stats.refresh();
    chai.expect((await stats.getStats()).count.function).to.equal(1002);

    baseStatus = 200;
    baseBody = '{"t0":"2026-10-20T00:00:00Z","function":"many"}';
    await stats.loadBase();
    await stats.refresh();
    chai.expect((await stats.getStats()).count.function).to.equal(1002);

    // A file with an older t0 than the current one
    baseBody = baseFile(new Date(Date.now() - 2 * HOUR_MS), {
      ...BASE_COUNTS,
      function: 1,
    });
    await stats.loadBase();
    await stats.refresh();
    chai.expect((await stats.getStats()).count.function).to.equal(1002);
    stats.stop();
  });

  it("should use a newer file at the next read", async function () {
    baseBody = baseFile(new Date(Date.now() - 3 * HOUR_MS), BASE_COUNTS);
    const stats = createStats();
    await stats.start();
    // t0 is before old(), so old() is in the delta
    chai.expect((await stats.getStats()).count.total).to.equal(1500 + 6);

    baseBody = baseFile(new Date(Date.now() - HOUR_MS), {
      ...BASE_COUNTS,
      total: 2000,
    });
    await stats.loadBase();
    await stats.refresh();
    chai.expect((await stats.getStats()).count.total).to.equal(2000 + 5);
    stats.stop();
  });
});
