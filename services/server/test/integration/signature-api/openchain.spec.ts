import chai from "chai";
import chaiHttp from "chai-http";
import { ServerFixture } from "../../helpers/ServerFixture";
import { id as keccak256 } from "ethers";
import { bytesFromString } from "../../../src/server/services/utils/database-util";
import { RWStorageIdentifiers } from "../../../src/server/services/storageServices/identifiers";
import { SourcifyDatabaseService } from "../../../src/server/services/storageServices/SourcifyDatabaseService";
import { BytesKeccak } from "../../../src/server/types";
import { MockVerificationExport } from "../../helpers/mocks";

chai.use(chaiHttp);

describe("Signature API OpenChain Endpoints", function () {
  const serverFixture = new ServerFixture();

  const testSignatures = [
    {
      signature: "transfer(address,uint256)",
      signature_hash_32: bytesFromString(
        keccak256("transfer(address,uint256)"),
      ) as BytesKeccak,
      signature_type: "function" as const,
    },
    {
      signature: "approve(address,uint256)",
      signature_hash_32: bytesFromString(
        keccak256("approve(address,uint256)"),
      ) as BytesKeccak,
      signature_type: "function" as const,
    },
    {
      signature: "balanceOf(address)",
      signature_hash_32: bytesFromString(
        keccak256("balanceOf(address)"),
      ) as BytesKeccak,
      signature_type: "function" as const,
    },
    {
      signature: "transferFrom(address,address,uint256)",
      signature_hash_32: bytesFromString(
        keccak256("transferFrom(address,address,uint256)"),
      ) as BytesKeccak,
      signature_type: "function" as const,
    },
    {
      signature: "test_underscore()",
      signature_hash_32: bytesFromString(
        keccak256("test_underscore()"),
      ) as BytesKeccak,
      signature_type: "function" as const,
    },
    {
      signature: "Transfer(address,address,uint256)",
      signature_hash_32: bytesFromString(
        keccak256("Transfer(address,address,uint256)"),
      ) as BytesKeccak,
      signature_type: "event" as const,
    },
    {
      signature: "Approval(address,address,uint256)",
      signature_hash_32: bytesFromString(
        keccak256("Approval(address,address,uint256)"),
      ) as BytesKeccak,
      signature_type: "event" as const,
    },
    {
      signature: "InsufficientBalance(uint256,uint256)",
      signature_hash_32: bytesFromString(
        keccak256("InsufficientBalance(uint256,uint256)"),
      ) as BytesKeccak,
      signature_type: "error" as const,
    },
    // Same signature_hash_4 as transfer(address,uint256) to test filtering
    {
      signature: "transfer(bytes4[9],bytes5[6],int48[11])",
      signature_hash_32: bytesFromString(
        keccak256("transfer(bytes4[9],bytes5[6],int48[11])"),
      ) as BytesKeccak,
      signature_type: "function" as const,
    },
  ];

  beforeEach(async function () {
    const databaseService = serverFixture.server.services.storage.rwServices[
      RWStorageIdentifiers.SourcifyDatabase
    ] as SourcifyDatabaseService;

    await databaseService.storeVerification(MockVerificationExport);

    await databaseService.database.insertSignatures(testSignatures);

    const compilationResult =
      await databaseService.database.getCompilationIdForVerifiedContract("1");
    const compilationId = compilationResult.rows[0].compilation_id;

    await databaseService.database.insertCompiledContractSignatures(
      compilationId,
      testSignatures,
    );
  });

  describe("GET /signature-database/v1/lookup", function () {
    it("should lookup function signatures by 4-byte hash and filter by default", async function () {
      const hash4 =
        "0x" +
        testSignatures[0].signature_hash_32.toString("hex").substring(0, 8);

      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/lookup")
        .query({ function: hash4 });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result.function).to.have.property(hash4);
      chai.expect(res.body.result.function[hash4]).to.be.an("array");
      chai.expect(res.body.result.function[hash4][0]).to.deep.include({
        name: "transfer(address,uint256)",
        filtered: false,
      });
      chai.expect(res.body.result.function[hash4]).to.not.have.deep.members([
        {
          name: "transfer(bytes4[9],bytes5[6],int48[11])",
          filtered: true,
        },
      ]);
    });

    it("should lookup function signatures by 32-byte hash", async function () {
      const hash32 = "0x" + testSignatures[0].signature_hash_32.toString("hex");

      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/lookup")
        .query({ function: hash32 });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result.function).to.have.property(hash32);
      chai.expect(res.body.result.function[hash32][0]).to.deep.include({
        name: "transfer(address,uint256)",
        filtered: false,
      });
    });

    it("should lookup event signatures by 32-byte hash", async function () {
      const hash32 =
        "0x" +
        testSignatures
          .find((sig) => sig.signature_type === "event")
          ?.signature_hash_32.toString("hex");

      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/lookup")
        .query({ event: hash32 });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result.event).to.have.property(hash32);
      chai.expect(res.body.result.event[hash32][0]).to.deep.include({
        name: "Transfer(address,address,uint256)",
        filtered: false,
      });
    });

    it("should lookup error signatures by hash", async function () {
      const hash4 =
        "0x" +
        testSignatures
          .find((sig) => sig.signature_type === "error")
          ?.signature_hash_32.toString("hex")
          .substring(0, 8);

      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/lookup")
        .query({ error: hash4 });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result.error).to.have.property(hash4);
      chai.expect(res.body.result.error[hash4][0]).to.deep.include({
        name: "InsufficientBalance(uint256,uint256)",
        filtered: false,
      });
    });

    it("should lookup multiple signatures at once", async function () {
      const functionHash =
        "0x" +
        testSignatures[0].signature_hash_32.toString("hex").substring(0, 8);
      const eventHash =
        "0x" + testSignatures[4].signature_hash_32.toString("hex");

      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/lookup")
        .query({
          function: functionHash,
          event: eventHash,
        });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result.function).to.have.property(functionHash);
      chai.expect(res.body.result.event).to.have.property(eventHash);
    });

    it("should handle comma-separated multiple hashes", async function () {
      const hash1 =
        "0x" +
        testSignatures[0].signature_hash_32.toString("hex").substring(0, 8);
      const hash2 =
        "0x" +
        testSignatures[1].signature_hash_32.toString("hex").substring(0, 8);

      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/lookup")
        .query({ function: `${hash1},${hash2}` });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result.function).to.have.property(hash1);
      chai.expect(res.body.result.function).to.have.property(hash2);
    });

    it("should return empty result for non-existent signatures", async function () {
      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/lookup")
        .query({ function: "0x12345678" });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result.function["0x12345678"]).to.be.an("array").that
        .is.empty;
    });

    it("should handle filter parameter", async function () {
      const hash4 =
        "0x" +
        testSignatures[0].signature_hash_32.toString("hex").substring(0, 8);

      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/lookup")
        .query({ function: hash4, filter: "false" });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result.function).to.have.property(hash4);
      chai.expect(res.body.result.function[hash4]).to.be.an("array");
      chai.expect(res.body.result.function[hash4]).to.have.deep.members([
        { name: "transfer(address,uint256)", filtered: false },
        { name: "transfer(bytes4[9],bytes5[6],int48[11])", filtered: true },
      ]);
    });

    it("should handle invalid hash format", async function () {
      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/lookup")
        .query({ function: "invalidhash" });

      chai.expect(res.status).to.equal(500);
    });
  });

  describe("GET /signature-database/v1/search", function () {
    it("should search signatures by pattern", async function () {
      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/search")
        .query({ query: testSignatures[0].signature });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result).to.have.property("function");
      chai.expect(res.body.result).to.have.property("event");
      chai.expect(res.body.result).to.have.property("error");
      chai.expect(res.body.result.function).to.be.an("object");
      const hash4 =
        "0x" +
        testSignatures[0].signature_hash_32.toString("hex").substring(0, 8);

      chai.expect(res.body.result.function[hash4][0]).to.deep.include({
        name: testSignatures[0].signature,
        filtered: false,
      });
    });

    it("should return empty results for non-matching pattern", async function () {
      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/search")
        .query({ query: "nonexistentfunction" });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(Object.keys(res.body.result.function)).to.be.empty;
      chai.expect(Object.keys(res.body.result.event)).to.be.empty;
      chai.expect(Object.keys(res.body.result.error)).to.be.empty;
    });

    it("should support wildcard search with *", async function () {
      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/search")
        .query({ query: "transfer*" });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;

      const functionResults = Object.values(
        res.body.result.function,
      ).flat() as any[];

      const transferResults = functionResults.filter((sig: any) =>
        sig.name.startsWith("transfer"),
      );
      chai.expect(transferResults.length).to.be.at.least(2);

      const hasTransfer = transferResults.some(
        (sig: any) => sig.name === "transfer(address,uint256)",
      );
      const hasTransferFrom = transferResults.some(
        (sig: any) => sig.name === "transferFrom(address,address,uint256)",
      );

      chai.expect(hasTransfer).to.be.true;
      chai.expect(hasTransferFrom).to.be.true;
    });

    it("should search with case sensitive pattern", async function () {
      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/search")
        .query({ query: "TRANSFER*" });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;

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
        .request(serverFixture.server.app)
        .get("/signature-database/v1/search")
        .query({ query: "approv?(address,uint256)" });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;

      const functionResults = Object.values(
        res.body.result.function,
      ).flat() as any[];
      const hasApproveFunction = functionResults.some((sig: any) =>
        sig.name.includes("approve"),
      );
      chai.expect(hasApproveFunction).to.be.true;
    });

    it("should escape underscore in search", async function () {
      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/search")
        .query({ query: "test_underscore()" });

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;

      const functionResults = Object.values(
        res.body.result.function,
      ).flat() as any[];
      const hasTestUnderscoreFunction = functionResults.some((sig: any) =>
        sig.name.includes("test_underscore"),
      );
      chai.expect(hasTestUnderscoreFunction).to.be.true;
    });

    it("should handle missing query parameter in search", async function () {
      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/search");

      chai.expect(res.status).to.be.at.least(400);
    });
  });

  describe("GET /signature-database/v1/stats", function () {
    it("should return signature statistics", async function () {
      const res = await chai
        .request(serverFixture.server.app)
        .get("/signature-database/v1/stats");

      chai.expect(res.status).to.equal(200);
      chai.expect(res.body.ok).to.be.true;
      chai.expect(res.body.result).to.have.property("count");
      chai.expect(res.body.result.count).to.have.property("function");
      chai.expect(res.body.result.count).to.have.property("event");
      chai.expect(res.body.result.count).to.have.property("error");

      const functionCount = testSignatures.filter(
        (sig) => sig.signature_type === "function",
      ).length;
      const eventCount = testSignatures.filter(
        (sig) => sig.signature_type === "event",
      ).length;
      const errorCount = testSignatures.filter(
        (sig) => sig.signature_type === "error",
      ).length;

      chai.expect(res.body.result.count.function).to.be.at.least(functionCount);
      chai.expect(res.body.result.count.event).to.be.at.least(eventCount);
      chai.expect(res.body.result.count.error).to.be.at.least(errorCount);
    });
  });
});
