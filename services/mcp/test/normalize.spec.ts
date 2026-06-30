import { expect } from "chai";
import { toVerificationStatus } from "../src/normalize";

describe("toVerificationStatus", function () {
  it("maps 'exact_match' to 'exact'", () => {
    expect(toVerificationStatus("exact_match")).to.equal("exact");
  });

  it("maps 'match' to 'partial'", () => {
    expect(toVerificationStatus("match")).to.equal("partial");
  });

  it("maps null to 'unverified'", () => {
    expect(toVerificationStatus(null)).to.equal("unverified");
  });

  it("maps undefined to 'unverified'", () => {
    expect(toVerificationStatus(undefined)).to.equal("unverified");
  });
});
