import { Request, Response } from "express";
import { expect } from "chai";
import * as sinon from "sinon";
import { validateCompilerVersion } from "../../../src/server/apiv2/middlewares";
import { InvalidParametersError } from "../../../src/server/apiv2/errors";

describe("validateCompilerVersion middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: sinon.SinonSpy;

  beforeEach(() => {
    req = {
      body: {},
    };
    res = {};
    next = sinon.spy();
  });

  // Test helper functions
  const testValidVersions = (
    versions: string[],
    language: string,
    description: string,
  ) => {
    it(description, () => {
      versions.forEach((version) => {
        next.resetHistory();
        const originalVersion = version;

        req.body = {
          compilerVersion: version,
          stdJsonInput: { language },
        };

        validateCompilerVersion(req as Request, res as Response, next);

        // Check that v prefix is stripped
        const expectedVersion = originalVersion.startsWith("v")
          ? originalVersion.slice(1)
          : originalVersion;

        expect(req.body.compilerVersion).to.equal(expectedVersion);
        expect(next.calledOnce).to.be.true;
      });
    });
  };

  const testInvalidVersions = (
    versions: string[],
    language: string,
    description: string,
  ) => {
    it(description, () => {
      versions.forEach((version) => {
        req.body = {
          compilerVersion: version,
          stdJsonInput: { language },
        };

        try {
          validateCompilerVersion(req as Request, res as Response, next);
          expect.fail(`Expected ${version} to throw an error but it didn't`);
        } catch (error: any) {
          expect(error).to.be.instanceOf(InvalidParametersError);
          expect(error.statusCode).to.equal(400);
          expect(error.payload.customCode).to.equal("invalid_parameter");
        }
      });
    });
  };

  describe("Basic validation", () => {
    it("should throw error when compilerVersion is missing", () => {
      req.body = {};

      try {
        validateCompilerVersion(req as Request, res as Response, next);
        expect.fail("Expected function to throw an error but it didn't");
      } catch (error: any) {
        expect(error).to.be.instanceOf(InvalidParametersError);
        expect(error.statusCode).to.equal(400);
        expect(error.payload.customCode).to.equal("invalid_parameter");
      }
    });

    it("should throw error when compilerVersion is empty string", () => {
      req.body = { compilerVersion: "" };

      try {
        validateCompilerVersion(req as Request, res as Response, next);
        expect.fail("Expected function to throw an error but it didn't");
      } catch (error: any) {
        expect(error).to.be.instanceOf(InvalidParametersError);
        expect(error.statusCode).to.equal(400);
        expect(error.payload.customCode).to.equal("invalid_parameter");
      }
    });

    it("should strip 'v' prefix from version", () => {
      req.body = {
        compilerVersion: "v0.8.7+commit.e28d00a7",
        stdJsonInput: { language: "Solidity" },
      };

      validateCompilerVersion(req as Request, res as Response, next);

      expect(req.body.compilerVersion).to.equal("0.8.7+commit.e28d00a7");
      expect(next.calledOnce).to.be.true;
    });
  });

  describe("Solidity version validation", () => {
    const validSolidityVersions = [
      // Regular versions
      "0.8.7+commit.e28d00a7",
      "0.8.30+commit.73712a01",
      "0.8.29+commit.ab55807c",
      "0.8.12+commit.f00d7308",
      "0.8.31+commit.73712a01",
      // Nightly versions
      "0.8.31-nightly.2025.8.11+commit.635fe8f8",
      "0.8.31-nightly.2025.7.31+commit.aef512f8",
      "0.8.31-nightly.2025.6.2+commit.5c3c9578",
      // With v prefix (should be stripped)
      "v0.8.20+commit.a1b79de6",
      "v0.8.7+commit.e28d00a7",
    ];

    const invalidSolidityVersions = [
      // Wrong commit hash length
      "0.8.7+commit.e28d00a", // too short
      "0.8.7+commit.e28d00a7123", // too long
      // Invalid commit hash characters
      "0.8.7+commit.g28d00a7", // contains 'g'
      "0.8.7+commit.E28D00A7", // uppercase
      "0.8.7+commit.e28D00A7", // mixed case
      // Missing commit hash
      "0.8.7",
      "0.8.31-nightly.2025.8.11",
      // Malformed nightly format
      "0.8.31-nightly.25.8.11+commit.635fe8f8", // 2-digit year
      "0.8.31-nightly.2025.8+commit.635fe8f8", // missing day
      // Invalid version format
      "invalid-version",
      "0.8+commit.e28d00a7",
    ];

    testValidVersions(
      validSolidityVersions,
      "Solidity",
      "should accept all valid Solidity versions",
    );

    testInvalidVersions(
      invalidSolidityVersions,
      "Solidity",
      "should reject all invalid Solidity versions",
    );
  });

  describe("Vyper version validation", () => {
    const validVyperVersions = [
      // With v prefix
      "v0.3.10",
      "v0.4.1rc1",
      "v0.4.1b4",
      "v0.1.0-beta.17",
      // Without v prefix
      "0.3.8+commit.036f1536",
      "0.4.2+commit.c216787f",
      "0.3.10",
      // Various suffixes
      "0.4.1rc1",
      "0.4.1b4",
      "0.1.0-beta.17",
    ];

    testValidVersions(
      validVyperVersions,
      "Vyper",
      "should accept all Vyper versions (permissive validation)",
    );
  });
});
