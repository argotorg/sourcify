import { expect } from "chai";
import { resolveServerUrl, DEFAULT_SERVER_URL } from "../src/config";

describe("resolveServerUrl", function () {
  it("defaults to the public Sourcify server when no env var is set", () => {
    expect(resolveServerUrl({})).to.equal(DEFAULT_SERVER_URL);
  });

  it("uses SOURCIFY_SERVER_URL when set", () => {
    expect(
      resolveServerUrl({ SOURCIFY_SERVER_URL: "http://localhost:5555" }),
    ).to.equal("http://localhost:5555");
  });

  it("ignores an empty SOURCIFY_SERVER_URL", () => {
    expect(resolveServerUrl({ SOURCIFY_SERVER_URL: "" })).to.equal(
      DEFAULT_SERVER_URL,
    );
  });
});
