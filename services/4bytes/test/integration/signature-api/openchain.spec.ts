import chai from "chai";
import { id as keccak256 } from "ethers";
import { Logger } from "winston";
import {
  SignatureDataProvider,
  SignatureStatsRow,
} from "../../../src/database";
import { createSignatureHandlers } from "../../../src/api/handlers";
import {
  validateHashQueries,
  validateSearchQuery,
} from "../../../src/api/validation";
import { SignatureType } from "../../../src/utils/signature-util";

interface MockSignature {
  signature: string;
  signature_type: SignatureType;
  signature_hash_32: string;
  signature_hash_4: string;
}

class MockSignatureDatabase implements SignatureDataProvider {
  private readonly byHash32 = new Map<string, MockSignature[]>();
  private readonly byHash4 = new Map<string, MockSignature[]>();
  private readonly stats: SignatureStatsRow[];

  constructor(private readonly signatures: MockSignature[]) {
    const now = new Date();
    const counts: Record<SignatureType, number> = {
      [SignatureType.Function]: 0,
      [SignatureType.Event]: 0,
      [SignatureType.Error]: 0,
    };

    for (const signature of signatures) {
      counts[signature.signature_type] += 1;

      const key32 = this.hashKey(signature.signature_hash_32, signature.signature_type);
      const key4 = this.hashKey(signature.signature_hash_4, signature.signature_type);

      this.byHash32.set(key32, [
        ...(this.byHash32.get(key32) ?? []),
        signature,
      ]);
      this.byHash4.set(key4, [
        ...(this.byHash4.get(key4) ?? []),
        signature,
      ]);
    }

    this.stats = Object.values(SignatureType).map((type) => ({
      signature_type: type,
      count: counts[type].toString(),
      created_at: now,
      refreshed_at: now,
    }));
  }

  private hashKey(hash: string, type: SignatureType): string {
    return `${type}:${hash.toLowerCase()}`;
  }

  private static escapeRegex(char: string): string {
    return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private static toRegex(pattern: string): RegExp {
    const sanitized = pattern
      .trim()
      .replace(/_/g, "\\_")
      .replace(/\*/g, "%")
      .replace(/\?/g, "_");

    let regex = "^";
    let escaping = false;

    for (const char of sanitized) {
      if (escaping) {
        regex += MockSignatureDatabase.escapeRegex(char);
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "%") {
        regex += ".*";
      } else if (char === "_") {
        regex += ".";
      } else {
        regex += MockSignatureDatabase.escapeRegex(char);
      }
    }

    regex += "$";
    return new RegExp(regex);
  }

  async getSignatureByHash32AndType(hash: Buffer, type: SignatureType) {
    const key = this.hashKey(`0x${hash.toString("hex")}`, type);
    return (this.byHash32.get(key) ?? []).map((entry) => ({
      signature: entry.signature,
    }));
  }

  async getSignatureByHash4AndType(hash: Buffer, type: SignatureType) {
    const key = this.hashKey(`0x${hash.toString("hex")}`, type);
    return (this.byHash4.get(key) ?? []).map((entry) => ({
      signature: entry.signature,
    }));
  }

  async searchSignaturesByPatternAndType(
    pattern: string,
    type: SignatureType,
    limit = 100,
  ) {
    const regex = MockSignatureDatabase.toRegex(pattern);
    const matches = this.signatures.filter(
      (entry) => entry.signature_type === type && regex.test(entry.signature),
    );

    return matches.slice(0, limit).map((entry) => ({
      signature: entry.signature,
      signature_hash_4: entry.signature_hash_4,
      signature_hash_32: entry.signature_hash_32,
    }));
  }

  async getSignatureCounts() {
    return this.stats;
  }
}

class MockResponse {
  statusCode = 200;
  body: unknown;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: unknown) {
    this.body = payload;
    return this;
  }
}

const runMiddleware = async (
  req: unknown,
  res: MockResponse,
  middleware: (req: any, res: any, next: (err?: unknown) => void) => void,
): Promise<boolean> => {
  let nextCalled = false;
  await new Promise<void>((resolve) => {
    middleware(req, res as unknown as any, () => {
      nextCalled = true;
      resolve();
    });
    setImmediate(() => {
      if (!nextCalled) {
        resolve();
      }
    });
  });
  return nextCalled;
};

const mockLogger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  silly: () => undefined,
  log: () => undefined,
} as unknown as Logger;

const makeMockSignatures = (): MockSignature[] => {
  const baseSignatures = [
    { signature: "transfer(address,uint256)", type: SignatureType.Function },
    { signature: "approve(address,uint256)", type: SignatureType.Function },
    { signature: "balanceOf(address)", type: SignatureType.Function },
    {
      signature: "transferFrom(address,address,uint256)",
      type: SignatureType.Function,
    },
    { signature: "test_underscore()", type: SignatureType.Function },
    {
      signature: "Transfer(address,address,uint256)",
      type: SignatureType.Event,
    },
    { signature: "Approval(address,address,uint256)", type: SignatureType.Event },
    {
      signature: "InsufficientBalance(uint256,uint256)",
      type: SignatureType.Error,
    },
  ];

  return baseSignatures.map(({ signature, type }) => {
    const hash32 = keccak256(signature);
    const hash4 = `0x${hash32.slice(2, 10)}`;
    return {
      signature,
      signature_type: type,
      signature_hash_32: hash32,
      signature_hash_4: hash4,
    };
  });
};

describe("Signature API OpenChain Endpoints", function () {
  const mockSignatures = makeMockSignatures();
  const database = new MockSignatureDatabase(mockSignatures);
  const handlers = createSignatureHandlers(database, mockLogger);

  describe("GET /signature-database/v1/lookup", function () {
    it("should lookup function signatures by 4-byte hash", async function () {
      const hash4 = mockSignatures[0].signature_hash_4;
      const req = { query: { function: hash4 } };
      const res = new MockResponse();

      await handlers.lookupSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      chai.expect(res.body).to.have.property("ok", true);
      chai
        .expect((res.body as any).result.function[hash4][0])
        .to.deep.include({
          name: mockSignatures[0].signature,
          filtered: false,
        });
    });

    it("should lookup function signatures by 32-byte hash", async function () {
      const hash32 = mockSignatures[0].signature_hash_32;
      const req = { query: { function: hash32 } };
      const res = new MockResponse();

      await handlers.lookupSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      chai.expect((res.body as any).result.function[hash32][0]).to.deep.include({
        name: mockSignatures[0].signature,
        filtered: false,
      });
    });

    it("should lookup event signatures by 32-byte hash", async function () {
      const event = mockSignatures.find(
        (entry) => entry.signature_type === SignatureType.Event,
      )!;
      const req = { query: { event: event.signature_hash_32 } };
      const res = new MockResponse();

      await handlers.lookupSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      chai
        .expect((res.body as any).result.event[event.signature_hash_32][0])
        .to.deep.include({
          name: event.signature,
          filtered: false,
        });
    });

    it("should lookup error signatures by hash", async function () {
      const errorSignature = mockSignatures.find(
        (entry) => entry.signature_type === SignatureType.Error,
      )!;
      const req = { query: { error: errorSignature.signature_hash_4 } };
      const res = new MockResponse();

      await handlers.lookupSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      chai
        .expect((res.body as any).result.error[errorSignature.signature_hash_4][0])
        .to.deep.include({
          name: errorSignature.signature,
          filtered: false,
        });
    });

    it("should lookup multiple signatures at once", async function () {
      const hash1 = mockSignatures[0].signature_hash_4;
      const hash2 = mockSignatures[1].signature_hash_4;
      const req = { query: { function: `${hash1},${hash2}` } };
      const res = new MockResponse();

      await handlers.lookupSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      chai.expect((res.body as any).result.function).to.have.property(hash1);
      chai.expect((res.body as any).result.function).to.have.property(hash2);
    });

    it("should return empty result for non-existent signatures", async function () {
      const req = { query: { function: "0x12345678" } };
      const res = new MockResponse();

      await handlers.lookupSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      chai
        .expect((res.body as any).result.function["0x12345678"]) // eslint-disable-line @typescript-eslint/dot-notation
        .to.be.an("array")
        .that.is.empty;
    });

    it("should handle filter parameter", async function () {
      const hash4 = mockSignatures[0].signature_hash_4;
      const req = { query: { function: hash4, filter: "false" } };
      const res = new MockResponse();

      await handlers.lookupSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      chai
        .expect((res.body as any).result.function[hash4][0])
        .to.have.property("filtered");
    });

    it("should handle invalid hash format", async function () {
      const req = { query: { function: "invalidhash" } };
      const res = new MockResponse();

      const nextCalled = await runMiddleware(
        req,
        res,
        validateHashQueries,
      );

      chai.expect(nextCalled).to.be.false;
      chai.expect(res.statusCode).to.equal(500);
      chai.expect(res.body).to.deep.include({ ok: false });
    });
  });

  describe("GET /signature-database/v1/search", function () {
    it("should search signatures by pattern", async function () {
      const req = { query: { query: mockSignatures[0].signature } };
      const res = new MockResponse();

      await handlers.searchSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      const hash4 = mockSignatures[0].signature_hash_4;
      chai
        .expect((res.body as any).result.function[hash4][0])
        .to.deep.include({
          name: mockSignatures[0].signature,
          filtered: false,
        });
    });

    it("should return empty results for non-matching pattern", async function () {
      const req = { query: { query: "nonexistentfunction" } };
      const res = new MockResponse();

      await handlers.searchSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      chai.expect(Object.keys((res.body as any).result.function)).to.be.empty;
      chai.expect(Object.keys((res.body as any).result.event)).to.be.empty;
      chai.expect(Object.keys((res.body as any).result.error)).to.be.empty;
    });

    it("should support wildcard search with *", async function () {
      const req = { query: { query: "transfer*" } };
      const res = new MockResponse();

      await handlers.searchSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      const functionResults = Object.values(
        (res.body as any).result.function,
      ).flat() as any[];
      const transferResults = functionResults.filter((sig: any) =>
        sig.name.startsWith("transfer"),
      );
      chai.expect(transferResults.length).to.be.at.least(2);
    });

    it("should search with case sensitive pattern", async function () {
      const req = { query: { query: "TRANSFER*" } };
      const res = new MockResponse();

      await handlers.searchSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      const functionResults = Object.values(
        (res.body as any).result.function,
      ).flat() as any[];
      const hasTransferFunction = functionResults.some((sig: any) =>
        sig.name.includes("transfer"),
      );
      chai.expect(hasTransferFunction).to.be.false;
    });

    it("should support wildcard search with ?", async function () {
      const req = { query: { query: "approv?(address,uint256)" } };
      const res = new MockResponse();

      await handlers.searchSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      const functionResults = Object.values(
        (res.body as any).result.function,
      ).flat() as any[];
      const hasApproveFunction = functionResults.some((sig: any) =>
        sig.name.includes("approve"),
      );
      chai.expect(hasApproveFunction).to.be.true;
    });

    it("should escape underscore in search", async function () {
      const req = { query: { query: "test_underscore()" } };
      const res = new MockResponse();

      await handlers.searchSignatures(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      const functionResults = Object.values(
        (res.body as any).result.function,
      ).flat() as any[];
      const hasTestUnderscoreFunction = functionResults.some((sig: any) =>
        sig.name.includes("test_underscore"),
      );
      chai.expect(hasTestUnderscoreFunction).to.be.true;
    });

    it("should handle missing query parameter in search", async function () {
      const req = { query: {} };
      const res = new MockResponse();

      const nextCalled = await runMiddleware(req, res, validateSearchQuery);

      chai.expect(nextCalled).to.be.false;
      chai.expect(res.statusCode).to.equal(500);
      chai.expect(res.body).to.deep.include({ ok: false });
    });
  });

  describe("GET /signature-database/v1/stats", function () {
    it("should return signature statistics", async function () {
      const req = { query: {} };
      const res = new MockResponse();

      await handlers.getSignaturesStats(req as any, res as any);

      chai.expect(res.statusCode).to.equal(200);
      chai.expect((res.body as any).result).to.have.property("count");
      chai
        .expect((res.body as any).result.count.function)
        .to.equal(
          mockSignatures.filter(
            (entry) => entry.signature_type === SignatureType.Function,
          ).length,
        );
    });
  });
});
