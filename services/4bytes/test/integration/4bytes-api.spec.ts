import chai from "chai";
import chaiHttp from "chai-http";
import { id as keccak256 } from "ethers";
import {
  FourByteServerFixture,
  TestSignature,
} from "../helpers/FourByteServerFixture";
import { SignatureType } from "../../src/utils/signature-util";

chai.use(chaiHttp);

describe("4Bytes API End-to-End Tests", function () {
  const serverFixture = new FourByteServerFixture();

  describe("GET /signature-database/v1/lookup", function () {
    beforeEach(async function () {
      await serverFixture.insertTestSignatures(
        FourByteServerFixture.testSignatures,
      );
    });

    it("should lookup function signatures by 4-byte hash", async function () {
      const signature = "transfer(address,uint256)";
      const hash4 = keccak256(signature).slice(0, 10);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: hash4 });

      chai.expect(res).to.have.status(200);
      chai.expect(res.body).to.have.property("ok", true);
      chai.expect(res.body.result.function[hash4]).to.be.an("array");
      chai.expect(res.body.result.function[hash4][0]).to.deep.include({
        name: signature,
        filtered: false,
      });
    });

    it("should lookup function signatures by 32-byte hash", async function () {
      const signature = "balanceOf(address)";
      const hash32 = keccak256(signature);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: hash32 });

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result.function[hash32][0]).to.deep.include({
        name: signature,
        filtered: false,
      });
    });

    it("should lookup event signatures by 32-byte hash", async function () {
      const signature = "Transfer(address,address,uint256)";
      const hash32 = keccak256(signature);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ event: hash32 });

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result.event[hash32][0]).to.deep.include({
        name: signature,
        filtered: false,
      });
    });

    it("should lookup error signatures by 4-byte hash", async function () {
      const signature = "InsufficientBalance(uint256,uint256)";
      const hash4 = keccak256(signature).slice(0, 10);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ error: hash4 });

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result.error[hash4][0]).to.deep.include({
        name: signature,
        filtered: false,
      });
    });

    it("should lookup multiple signatures at once", async function () {
      const sig1 = "transfer(address,uint256)";
      const sig2 = "approve(address,uint256)";
      const hash1 = keccak256(sig1).slice(0, 10);
      const hash2 = keccak256(sig2).slice(0, 10);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: `${hash1},${hash2}` });

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result.function).to.have.property(hash1);
      chai.expect(res.body.result.function).to.have.property(hash2);
      chai.expect(res.body.result.function[hash1][0].name).to.equal(sig1);
      chai.expect(res.body.result.function[hash2][0].name).to.equal(sig2);
    });

    it("should return empty result for non-existent signatures", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: "0x12345678" });

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result.function["0x12345678"]).to.be.an("array").that
        .is.empty;
    });

    it("should filter spam signatures by default", async function () {
      const collusionSignature =
        "_____$_$__$___$$$___$$___$__$$(address,uint256)";
      const collusionHash4 = keccak256(collusionSignature).slice(0, 10);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: collusionHash4 });

      chai.expect(res).to.have.status(200);
      chai
        .expect(res.body.result.function[collusionHash4])
        .to.be.an("array")
        .with.lengthOf(1);
      chai
        .expect(res.body.result.function[collusionHash4][0].name)
        .to.not.equal(collusionSignature);
    });

    it("should handle filter parameter to be false", async function () {
      const signature = "transfer(address,uint256)";
      const hash4 = keccak256(signature).slice(0, 10);
      const collusionSignature =
        "_____$_$__$___$$$___$$___$__$$(address,uint256)";
      const collusionHash4 = keccak256(collusionSignature).slice(0, 10);

      chai.expect(collusionHash4).to.equal(hash4);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: hash4, filter: "false" });

      chai.expect(res).to.have.status(200);
      const names = res.body.result.function[hash4].map((obj: any) => obj.name);
      chai.expect(names).to.include(signature);
      chai.expect(names).to.include(collusionSignature);
    });

    it("should handle mixed signature types in one request", async function () {
      const funcSig = "transfer(address,uint256)";
      const eventSig = "Transfer(address,address,uint256)";
      const errorSig = "InsufficientBalance(uint256,uint256)";

      const funcHash = keccak256(funcSig).slice(0, 10);
      const eventHash = keccak256(eventSig);
      const errorHash = keccak256(errorSig).slice(0, 10);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({
          function: funcHash,
          event: eventHash,
          error: errorHash,
        });

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result.function[funcHash][0].name).to.equal(funcSig);
      chai.expect(res.body.result.event[eventHash][0].name).to.equal(eventSig);
      chai.expect(res.body.result.error[errorHash][0].name).to.equal(errorSig);
    });

    it("should handle invalid hash format with proper error", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: "invalidhash" });

      chai.expect(res).to.have.status(500);
      chai.expect(res.body).to.have.property("ok", false);
    });
  });

  describe("GET /signature-database/v1/search", function () {
    beforeEach(async function () {
      await serverFixture.insertTestSignatures(
        FourByteServerFixture.testSignatures,
      );
    });

    it("should search signatures by exact pattern", async function () {
      const signature = "transfer(address,uint256)";

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search")
        .query({ query: signature });

      chai.expect(res).to.have.status(200);
      const hash4 = keccak256(signature).slice(0, 10);
      chai.expect(res.body.result.function[hash4][0]).to.deep.include({
        name: signature,
        filtered: false,
      });
    });

    it("should return empty results for non-matching pattern", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search")
        .query({ query: "nonexistentfunction" });

      chai.expect(res).to.have.status(200);
      chai.expect(Object.keys(res.body.result.function)).to.be.empty;
      chai.expect(Object.keys(res.body.result.event)).to.be.empty;
      chai.expect(Object.keys(res.body.result.error)).to.be.empty;
    });

    it("should support wildcard search with *", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search")
        .query({ query: "transfer*" });

      chai.expect(res).to.have.status(200);
      const functionResults = Object.values(
        res.body.result.function,
      ).flat() as any[];
      const transferResults = functionResults.filter((sig: any) =>
        sig.name.startsWith("transfer"),
      );
      chai.expect(transferResults.length).to.be.at.least(2); // transfer and transferFrom
    });

    it("should be case sensitive in pattern matching", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search")
        .query({ query: "TRANSFER*" });

      chai.expect(res).to.have.status(200);
      const functionResults = Object.values(
        res.body.result.function,
      ).flat() as any[];
      const hasTransferFunction = functionResults.some((sig: any) =>
        sig.name.includes("transfer"),
      );
      chai.expect(hasTransferFunction).to.be.false;
    });

    it("should support wildcard search with ?", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search")
        .query({ query: "approv?(address,uint256)" });

      chai.expect(res).to.have.status(200);
      const functionResults = Object.values(
        res.body.result.function,
      ).flat() as any[];
      const hasApproveFunction = functionResults.some((sig: any) =>
        sig.name.includes("approve"),
      );
      chai.expect(hasApproveFunction).to.be.true;
    });

    it("should escape underscore in search patterns", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search")
        .query({ query: "test_underscore()" });

      chai.expect(res).to.have.status(200);
      const functionResults = Object.values(
        res.body.result.function,
      ).flat() as any[];
      const hasTestUnderscoreFunction = functionResults.some(
        (sig: any) => sig.name === "test_underscore()",
      );
      chai.expect(hasTestUnderscoreFunction).to.be.true;
    });

    it("should handle missing query parameter with error", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search");

      chai.expect(res).to.have.status(500);
      chai.expect(res.body).to.have.property("ok", false);
    });

    it("should find signatures across different types", async function () {
      // Search for "address" - should find functions, events, and errors containing this
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search")
        .query({ query: "*address*" });

      chai.expect(res).to.have.status(200);

      // Should find functions with address parameters
      const functionResults = Object.values(
        res.body.result.function,
      ).flat() as any[];
      chai.expect(functionResults.length).to.be.greaterThan(0);

      // Should find events with address parameters
      const eventResults = Object.values(res.body.result.event).flat() as any[];
      chai.expect(eventResults.length).to.be.greaterThan(0);

      // Should find errors with address parameters
      const errorResults = Object.values(res.body.result.error).flat() as any[];
      chai.expect(errorResults.length).to.be.greaterThan(0);
    });
  });

  describe("GET /signature-database/v1/stats", function () {
    beforeEach(async function () {
      await serverFixture.insertTestSignatures(
        FourByteServerFixture.testSignatures,
      );
    });

    it("should return signature statistics", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/stats");

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result).to.have.property("count");

      // Count expected signatures by type
      const expectedCounts = FourByteServerFixture.testSignatures.reduce(
        (counts, sig) => {
          counts[sig.type] = (counts[sig.type] || 0) + 1;
          return counts;
        },
        {} as Record<SignatureType, number>,
      );

      chai
        .expect(res.body.result.count.function)
        .to.equal(expectedCounts[SignatureType.Function] || 0);
      chai
        .expect(res.body.result.count.event)
        .to.equal(expectedCounts[SignatureType.Event] || 0);
      chai
        .expect(res.body.result.count.error)
        .to.equal(expectedCounts[SignatureType.Error] || 0);
    });

    it("should return zero counts for empty database", async function () {
      // Reset database without inserting test signatures
      await serverFixture.resetDatabase();

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/stats");

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result.count.function).to.equal(0);
      chai.expect(res.body.result.count.event).to.equal(0);
      chai.expect(res.body.result.count.error).to.equal(0);
    });
  });

  describe("GET /health", function () {
    it("should return health status", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/health");

      chai.expect(res).to.have.status(200);
      chai.expect(res.body).to.deep.equal({
        status: "ok",
        service: "4bytes-api",
      });
    });
  });

  describe("Error handling", function () {
    it("should return 404 for non-existent endpoints", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/non-existent-endpoint");

      chai.expect(res).to.have.status(404);
    });

    it("should handle malformed requests gracefully", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: "not-a-hex-string" });

      chai.expect(res).to.have.status(500);
      chai.expect(res.body).to.have.property("ok", false);
    });
  });

  describe("Database operations", function () {
    it("should handle large result sets efficiently", async function () {
      // Create a larger dataset for testing
      const largeSignatureSet: TestSignature[] = [];
      for (let i = 0; i < 50; i++) {
        largeSignatureSet.push({
          signature: `testFunction${i}(uint256)`,
          type: SignatureType.Function,
        });
      }

      await serverFixture.insertTestSignatures(largeSignatureSet);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search")
        .query({ query: "testFunction*" });

      chai.expect(res).to.have.status(200);
      const functionResults = Object.values(
        res.body.result.function,
      ).flat() as any[];
      chai.expect(functionResults.length).to.equal(50);
    });

    it("should maintain data consistency across requests", async function () {
      await serverFixture.insertTestSignatures(
        FourByteServerFixture.testSignatures,
      );

      // Make multiple concurrent requests
      const requests = Array(10)
        .fill(0)
        .map(() =>
          chai
            .request(`http://localhost:${serverFixture.port}`)
            .get("/signature-database/v1/stats"),
        );

      const responses = await Promise.all(requests);

      // All responses should have the same data
      const firstResponse = responses[0].body;
      responses.forEach((res, index) => {
        chai.expect(res).to.have.status(200);
        chai
          .expect(res.body)
          .to.deep.equal(
            firstResponse,
            `Response ${index} should match first response`,
          );
      });
    });
  });
});
