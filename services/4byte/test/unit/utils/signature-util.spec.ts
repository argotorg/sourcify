import chai from "chai";
import { getCanonicalSignatures } from "../../../src/utils/signature-util";

describe("4byte signature-util", function () {
  describe("getCanonicalSignatures", function () {
    it("should return consistent object with valid structure", function () {
      const result1 = getCanonicalSignatures();
      const result2 = getCanonicalSignatures();

      // Should return consistent results
      chai.expect(result1).to.deep.equal(result2);

      // Should be an object
      chai.expect(result1).to.be.an("object");

      // Check structure of entries
      const entries = Object.entries(result1);
      entries.forEach(([hash, data]) => {
        chai.expect(hash).to.be.a("string");
        chai.expect(hash).to.match(/^0x[a-fA-F0-9]+$/); // Should be hex string

        if (
          data &&
          typeof data === "object" &&
          "signature" in data &&
          data.signature
        ) {
          chai.expect(data.signature).to.be.a("string");
          chai.expect(data.signature.length).to.be.greaterThan(0);
        }
      });
    });
  });
});
