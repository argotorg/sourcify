import chai from "chai";
import chaiHttp from "chai-http";
import { id as keccak256str } from "ethers";
import {
  FourByteServerFixture,
  TestSignature,
} from "../helpers/FourByteServerFixture";
import { SignatureType } from "../../src/utils/signature-util";

chai.use(chaiHttp);

describe("4byte API End-to-End Tests", function () {
  const serverFixture = new FourByteServerFixture();

  /**
   * API Compatibility Note:
   * This API maintains compatibility with openchain.xyz behavior:
   * - Function signatures return null for no matches or invalid hashes
   * - Event signatures return empty arrays for no matches or invalid hashes
   * - Hash validation: functions must be exactly 10 chars (0x + 8 hex), events must be exactly 66 chars (0x + 64 hex)
   */

  describe("GET /signature-database/v1/lookup", function () {
    it("should lookup function signatures by 4-byte hash and filter by default", async function () {
      const signature = "transfer(address,uint256)";
      const hash4 = keccak256str(signature).slice(0, 10);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: hash4 });

      chai.expect(res).to.have.status(200);
      chai.expect(res.body).to.have.property("ok", true);
      chai.expect(res.body.result.function[hash4]).to.be.an("array");
      chai.expect(res.body.result.function[hash4].length).to.equal(1);
      chai.expect(res.body.result.function[hash4][0]).to.deep.include({
        name: signature,
        filtered: false,
      });
    });

    it("should return null for function signatures when using 32-byte hash (openchain.xyz compatible)", async function () {
      const signature = "balanceOf(address)";
      const hash32 = keccak256str(signature);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: hash32 });

      chai.expect(res).to.have.status(200);
      // Function lookup with 32-byte hash should return null due to length validation (openchain.xyz compatible)
      chai.expect(res.body.result.function[hash32]).to.be.null;
    });

    it("should lookup event signatures by 32-byte hash", async function () {
      const signature = "Transfer(address,address,uint256)";
      const hash32 = keccak256str(signature);

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

    it("should lookup multiple signatures at once", async function () {
      const eventSignature = "Transfer(address,address,uint256)";
      const eventHash = keccak256str(eventSignature);
      const functionSignature = "transfer(address,uint256)";
      const functionHash = keccak256str(functionSignature).slice(0, 10);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: functionHash, event: eventHash });

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result.function).to.have.property(functionHash);
      chai.expect(res.body.result.event).to.have.property(eventHash);
      chai
        .expect(res.body.result.function[functionHash][0].name)
        .to.equal(functionSignature);
      chai
        .expect(res.body.result.event[eventHash][0].name)
        .to.equal(eventSignature);
    });

    it("should lookup comma-delimited signatures at once", async function () {
      const sig1 = "transfer(address,uint256)";
      const sig2 = "approve(address,uint256)";
      const hash1 = keccak256str(sig1).slice(0, 10);
      const hash2 = keccak256str(sig2).slice(0, 10);

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

    it("should return null for non-existent function signatures (openchain.xyz compatible)", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: "0x12345678" });

      chai.expect(res).to.have.status(200);
      // Openchain API returns null for functions with no matches, empty array for events
      chai.expect(res.body.result.function["0x12345678"]).to.be.null;
    });

    it("should return empty array for non-existent event signatures (openchain.xyz compatible)", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ event: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" });

      chai.expect(res).to.have.status(200);
      // Openchain API returns null for functions with no matches, empty array for events
      chai.expect(res.body.result.event["0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"]).to.be.an("array").that.is.empty;
    });

    it("should return 500 for invalid function hash lengths", async function () {
      const testCases = ["0x123", "0x12345", "0x123456789", "0x123456789abc"]; // Various invalid lengths

      for (const invalidHash of testCases) {
        const res = await chai
          .request(`http://localhost:${serverFixture.port}`)
          .get("/signature-database/v1/lookup")
          .query({ function: invalidHash });

        chai.expect(res).to.have.status(500);
        chai.expect(res.body).to.have.property("ok", false);
        chai.expect(res.body.error).to.include("Invalid hash");
      }
    });

    it("should return 500 for invalid event hash lengths", async function () {
      const testCases = ["0x123", "0x12345", "0x123456789abc", "0x123456789abcdef"]; // Various invalid lengths

      for (const invalidHash of testCases) {
        const res = await chai
          .request(`http://localhost:${serverFixture.port}`)
          .get("/signature-database/v1/lookup")
          .query({ event: invalidHash });

        chai.expect(res).to.have.status(500);
        chai.expect(res.body).to.have.property("ok", false);
        chai.expect(res.body.error).to.include("Invalid hash");
      }
    });

    it("should handle filter parameter to be false", async function () {
      const signature = "transfer(address,uint256)";
      const hash4 = keccak256str(signature).slice(0, 10);
      const collusionSignature =
        "_____$_$__$___$$$___$$___$__$$(address,uint256)";
      const collusionHash4 = keccak256str(collusionSignature).slice(0, 10);

      chai.expect(collusionHash4).to.equal(hash4);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: hash4, filter: "false" });

      chai.expect(res).to.have.status(200);
      // With filter=false, we should get both canonical and non-canonical signatures
      chai.expect(res.body.result.function[hash4]).to.have.deep.members([
        { name: signature, filtered: false, hasVerifiedContract: true },
        { name: collusionSignature, filtered: true, hasVerifiedContract: true },
      ]);
    });

    it("should return 500 for invalid hash format", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: "invalidhash" });

      chai.expect(res).to.have.status(500);
      chai.expect(res.body).to.have.property("ok", false);
      chai.expect(res.body.error).to.include("Invalid hash");
    });

    it("should validate exact hash lengths correctly", async function () {
      // Test exact valid lengths
      const validFunctionHash = "0x12345678"; // 10 characters
      const validEventHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"; // 66 characters

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: validFunctionHash, event: validEventHash });

      chai.expect(res).to.have.status(200);
      // Even though these hashes don't exist, they should return proper null/empty responses due to correct length
      chai.expect(res.body.result.function[validFunctionHash]).to.be.null;
      chai.expect(res.body.result.event[validEventHash]).to.be.an("array").that.is.empty;
    });
  });

  describe("GET /signature-database/v1/search", function () {
    it("should search signatures by exact pattern", async function () {
      const signature = "transfer(address,uint256)";

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/search")
        .query({ query: signature });

      chai.expect(res).to.have.status(200);
      const hash4 = keccak256str(signature).slice(0, 10);
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

      // This should be false
      const hasTestTUnderscoreFunction = functionResults.some(
        (sig: any) => sig.name === "testtunderscore()", // This is to distinguish if "_" is parsed as a SQL wildcard.
      );
      chai.expect(hasTestTUnderscoreFunction).to.be.false;
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
      // Search for "address" - should find functions and events containing this
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
    });
  });

  describe("POST /signature-database/v1/import", function () {
    it("should import valid function signatures", async function () {
      const functionSignatures = [
        "newFunction(uint256)",
        "anotherFunction(address,bool)",
      ];
      const functionHashes = functionSignatures.map((sig) =>
        keccak256str(sig).slice(0, 10),
      );
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: functionSignatures,
          event: [],
        });

      if (res.status !== 200 || !res.body.ok) {
        console.log("Import failed - Status:", res.status);
        console.log("Response body:", JSON.stringify(res.body, null, 2));
      } else if (Object.keys(res.body.result.function.imported).length === 0) {
        console.log("Import succeeded but returned empty results:");
        console.log("Response body:", JSON.stringify(res.body, null, 2));
      }

      chai.expect(res).to.have.status(200);
      chai.expect(res.body).to.have.property("ok", true);
      chai
        .expect(res.body.result.function.imported)
        .to.have.property(functionSignatures[0]);
      chai
        .expect(res.body.result.function.imported)
        .to.have.property(functionSignatures[1]);
      chai.expect(res.body.result.function.invalid).to.be.an("array").that.is
        .empty;
      chai.expect(res.body.result.event.imported).to.deep.equal({});

      const res2 = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({
          function: functionHashes.join(","),
        });

      chai.expect(res2).to.have.status(200);
      chai
        .expect(res2.body.result.function[functionHashes[0]][0].name)
        .to.equal(functionSignatures[0]);
      chai
        .expect(res2.body.result.function[functionHashes[1]][0].name)
        .to.equal(functionSignatures[1]);
    });

    it("should import valid event signatures", async function () {
      const eventSignatures = [
        "NewEvent(uint256,address)",
        "AnotherEvent(bool)",
      ];
      const eventHashes = eventSignatures.map((sig) => keccak256str(sig));
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: [],
          event: eventSignatures,
        });

      chai.expect(res).to.have.status(200);
      chai
        .expect(res.body.result.event.imported)
        .to.have.property(eventSignatures[0]);
      chai
        .expect(res.body.result.event.imported)
        .to.have.property(eventSignatures[1]);
      chai.expect(res.body.result.event.invalid).to.be.an("array").that.is
        .empty;
      chai.expect(res.body.result.function.imported).to.deep.equal({});

      const res2 = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({
          event: eventHashes.join(","),
        });

      chai.expect(res2).to.have.status(200);
      chai
        .expect(res2.body.result.event[eventHashes[0]][0].name)
        .to.equal(eventSignatures[0]);
      chai
        .expect(res2.body.result.event[eventHashes[1]][0].name)
        .to.equal(eventSignatures[1]);
    });

    it("should handle duplicate signatures", async function () {
      // First import
      await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: ["duplicateTest(uint256)"],
          event: [],
        });

      // Second import with same signature
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: ["duplicateTest(uint256)"],
          event: [],
        });

      chai.expect(res).to.have.status(200);
      chai
        .expect(res.body.result.function.duplicated)
        .to.have.property("duplicateTest(uint256)");
      chai.expect(res.body.result.function.imported).to.deep.equal({});
      chai.expect(res.body.result.function.invalid).to.be.an("array").that.is
        .empty;
    });

    it("should handle invalid signatures", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: [
            "invalid_signature",
            "malformed(",
            "validFunction(uint256)",
          ],
          event: ["BadEvent(uint256", "ValidEvent(address,uint256)"],
        });

      chai.expect(res).to.have.status(200);
      chai
        .expect(res.body.result.function.imported)
        .to.have.property("validFunction(uint256)");
      chai
        .expect(res.body.result.function.invalid)
        .to.include.members(["invalid_signature", "malformed("]);
      chai
        .expect(res.body.result.event.imported)
        .to.have.property("ValidEvent(address,uint256)");
      chai
        .expect(res.body.result.event.invalid)
        .to.include.members(["BadEvent(uint256"]);
    });

    it("should return correct hash types for function vs event signatures", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: ["testFunc(uint256)"],
          event: ["TestEvent(uint256)"],
        });

      chai.expect(res).to.have.status(200);

      // Function should get 4-byte hash
      const functionHash = Object.values(
        res.body.result.function.imported,
      )[0] as string;
      chai.expect(functionHash).to.match(/^0x[a-f0-9]{8}$/);

      // Event should get 32-byte hash
      const eventHash = Object.values(
        res.body.result.event.imported,
      )[0] as string;
      chai.expect(eventHash).to.match(/^0x[a-f0-9]{64}$/);
    });

    it("should handle mixed valid/invalid/duplicate signatures", async function () {
      // First import some signatures
      await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: ["existingFunc(uint256)"],
          event: ["ExistingEvent(address)"],
        });

      // Second import with mix of all types
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: [
            "existingFunc(uint256)", // duplicate
            "newFunc(bool)", // new valid
            "invalid_func", // invalid
          ],
          event: [
            "ExistingEvent(address)", // duplicate
            "NewEvent(uint256,bool)", // new valid
            "InvalidEvent(", // invalid
          ],
        });

      chai.expect(res).to.have.status(200);
      chai
        .expect(res.body.result.function.duplicated)
        .to.have.property("existingFunc(uint256)");
      chai
        .expect(res.body.result.function.imported)
        .to.have.property("newFunc(bool)");
      chai.expect(res.body.result.function.invalid).to.include("invalid_func");

      chai
        .expect(res.body.result.event.duplicated)
        .to.have.property("ExistingEvent(address)");
      chai
        .expect(res.body.result.event.imported)
        .to.have.property("NewEvent(uint256,bool)");
      chai.expect(res.body.result.event.invalid).to.include("InvalidEvent(");
    });

    it("should return error for no signatures provided", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({});

      chai.expect(res).to.have.status(400);
      chai.expect(res.body).to.have.property("ok", false);
      chai.expect(res.body).to.have.property("error", "No signatures provided");
    });

    it("should return error for empty arrays", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: [],
          event: [],
        });

      chai.expect(res).to.have.status(400);
      chai.expect(res.body).to.have.property("ok", false);
      chai.expect(res.body).to.have.property("error", "No signatures provided");
    });

    it("should handle large batch of signatures", async function () {
      const functionSignatures = Array(50)
        .fill(0)
        .map((_, i) => `batchFunc${i}(uint256)`);
      const eventSignatures = Array(50)
        .fill(0)
        .map((_, i) => `BatchEvent${i}(address)`);

      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .post("/signature-database/v1/import")
        .send({
          function: functionSignatures,
          event: eventSignatures,
        });

      chai.expect(res).to.have.status(200);
      chai
        .expect(Object.keys(res.body.result.function.imported))
        .to.have.lengthOf(50);
      chai
        .expect(Object.keys(res.body.result.event.imported))
        .to.have.lengthOf(50);
      chai.expect(res.body.result.function.invalid).to.be.an("array").that.is
        .empty;
      chai.expect(res.body.result.event.invalid).to.be.an("array").that.is
        .empty;
    });
  });

  describe("GET /signature-database/v1/stats", function () {
    it("should return signature statistics", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/stats");

      chai.expect(res).to.have.status(200);
      chai.expect(res.body.result).to.have.property("count");
      chai.expect(res.body.result.count).to.have.property("function");
      chai.expect(res.body.result.count).to.have.property("event");
      chai.expect(res.body.result.count).to.have.property("error");
      chai.expect(res.body.result.count).to.have.property("unknown");
      chai.expect(res.body.result.count).to.have.property("total");

      // total should be the number of unique signatures in the database
      chai.expect(res.body.result.count.total).to.be.equal(
        new Set( // Use a set to count unique signatures
          FourByteServerFixture.testSignatures.map((sig) => sig.signature),
        ).size,
      );
      // unknown should be the number of signatures that are not associated with a verified contract
      chai
        .expect(res.body.result.count.unknown)
        .to.be.equal(
          FourByteServerFixture.testSignatures.filter(
            (sig) => sig.type === undefined,
          ).length,
        );
      // error should be the number of error signatures
      chai
        .expect(res.body.result.count.error)
        .to.be.equal(
          FourByteServerFixture.testSignatures.filter(
            (sig) => sig.type === SignatureType.Error,
          ).length,
        );
      // function should be the number of function signatures
      chai
        .expect(res.body.result.count.function)
        .to.be.equal(
          FourByteServerFixture.testSignatures.filter(
            (sig) => sig.type === SignatureType.Function,
          ).length,
        );
      // event should be the number of event signatures
      chai
        .expect(res.body.result.count.event)
        .to.be.equal(
          FourByteServerFixture.testSignatures.filter(
            (sig) => sig.type === SignatureType.Event,
          ).length,
        );

      // refreshed_at
      chai.expect(res.body.result).to.have.property("metadata");
      chai.expect(res.body.result.metadata).to.have.property("refreshed_at");
      // should be a valid ISO string
      chai
        .expect(new Date(res.body.result.metadata.refreshed_at).toISOString())
        .to.be.a("string");

      const functionCount = FourByteServerFixture.testSignatures.filter(
        (sig) => sig.type === SignatureType.Function,
      ).length;
      const eventCount = FourByteServerFixture.testSignatures.filter(
        (sig) => sig.type === SignatureType.Event,
      ).length;

      chai.expect(res.body.result.count.function).to.be.equal(functionCount);
      chai.expect(res.body.result.count.event).to.be.equal(eventCount);
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
    });
  });

  describe("GET /health", function () {
    it("should return health status", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/health");

      chai.expect(res).to.have.status(200);
      chai.expect(res.text).to.equal("Alive and kicking!");
    });
  });

  describe("Error handling", function () {
    it("should return 404 for non-existent endpoints", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/non-existent-endpoint");

      chai.expect(res).to.have.status(404);
    });

    it("should return 500 for malformed hash requests", async function () {
      const res = await chai
        .request(`http://localhost:${serverFixture.port}`)
        .get("/signature-database/v1/lookup")
        .query({ function: "not-a-hex-string" });

      chai.expect(res).to.have.status(500);
      chai.expect(res.body).to.have.property("ok", false);
      chai.expect(res.body.error).to.include("Invalid hash");
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

      // Reset database and insert large signature set
      await serverFixture.resetDatabase();
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
