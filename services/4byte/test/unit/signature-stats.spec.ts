import chai from "chai";
import {
  gcsDownloadUrl,
  parseBaseMaxAgeMs,
  parseSignatureStatsBase,
} from "../../src/SignatureStats";

describe("parseSignatureStatsBase", function () {
  it("should parse the BigQuery JSON export", function () {
    const base = parseSignatureStatsBase(
      '{"t0":"2026-10-20T09:25:49.227193Z","function":"4906592","event":"1199357","error":"556949","unknown":"3951695","total":"10600577"}\n',
    );
    chai.expect(base).to.deep.equal({
      t0: new Date("2026-10-20T09:25:49.227Z"),
      function: 4906592,
      event: 1199357,
      error: 556949,
      unknown: 3951695,
      total: 10600577,
    });
  });

  it("should accept numbers", function () {
    const base = parseSignatureStatsBase(
      '{"t0":"2026-10-20T00:00:00Z","function":1,"event":2,"error":3,"unknown":4,"total":10}',
    );
    chai.expect(base.total).to.equal(10);
  });

  it("should reject files that are not valid", function () {
    const valid = {
      t0: "2026-10-20T00:00:00Z",
      function: "1",
      event: "2",
      error: "3",
      unknown: "4",
      total: "10",
    };
    const cases = [
      "",
      "\n\n",
      "not json",
      JSON.stringify({ ...valid, t0: "yesterday" }),
      JSON.stringify({ ...valid, t0: 1760918400000 }),
      JSON.stringify({ ...valid, function: undefined }),
      JSON.stringify({ ...valid, event: "-1" }),
      JSON.stringify({ ...valid, error: "1.5" }),
      JSON.stringify({ ...valid, total: "" }),
      JSON.stringify({ ...valid, total: null }),
    ];
    for (const text of cases) {
      chai.expect(() => parseSignatureStatsBase(text), text).to.throw();
    }
  });
});

describe("gcsDownloadUrl", function () {
  it("should give the download URL of the JSON API", function () {
    chai
      .expect(gcsDownloadUrl("gs://bkt/dir/production-000000000000.json"))
      .to.equal(
        "https://storage.googleapis.com/storage/v1/b/bkt/o/dir%2Fproduction-000000000000.json?alt=media",
      );
  });

  it("should reject a URL without an object", function () {
    chai.expect(() => gcsDownloadUrl("gs://bkt")).to.throw("Invalid gs://");
    chai.expect(() => gcsDownloadUrl("gs://bkt/")).to.throw("Invalid gs://");
  });
});

describe("parseBaseMaxAgeMs", function () {
  it("should use the default if the setting is not set", function () {
    chai.expect(parseBaseMaxAgeMs(undefined)).to.equal(undefined);
    chai.expect(parseBaseMaxAgeMs("")).to.equal(undefined);
  });

  it("should convert hours to milliseconds", function () {
    chai.expect(parseBaseMaxAgeMs("720")).to.equal(720 * 60 * 60 * 1000);
  });

  it("should reject a value that is not a positive number", function () {
    chai.expect(() => parseBaseMaxAgeMs("0")).to.throw("Invalid");
    chai.expect(() => parseBaseMaxAgeMs("two")).to.throw("Invalid");
  });
});
