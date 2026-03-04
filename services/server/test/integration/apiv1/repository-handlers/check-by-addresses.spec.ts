import { assertValidationError } from "../../../helpers/assertions";
import { CHECK_ENDPOINTS_DEPRECATION_WARNING } from "../../../../src/server/apiv1/controllers.common";
import chai from "chai";
import chaiHttp from "chai-http";
import { StatusCodes } from "http-status-codes";
import {
  deployFromAbiAndBytecode,
  invalidAddress,
} from "../../../helpers/helpers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import type { Done } from "mocha";
import type { Response } from "superagent";
import type { ProxyType } from "../../../../src/server/services/utils/proxy-contract-util";
import fs from "fs";
import path from "path";
import sinon from "sinon";
import * as proxyContractUtil from "../../../../src/server/services/utils/proxy-contract-util";

chai.use(chaiHttp);

/**
 * Lookup (check-by-address etc.) doesn't return chainId, otherwise same as assertVerification
 */
const assertLookup = (
  err: Error | null,
  res: Response,
  expectedAddress: string,
  expectedStatus: string,
  done?: Done,
) => {
  chai.expect(err).to.be.null;
  chai.expect(res.status).to.equal(StatusCodes.OK);
  const resultArray = res.body;
  chai.expect(resultArray).to.have.a.lengthOf(1);
  const result = resultArray[0];
  chai.expect(result.status).to.equal(expectedStatus);
  chai.expect(result.address).to.equal(expectedAddress);
  chai.expect(result.warning).to.equal(CHECK_ENDPOINTS_DEPRECATION_WARNING);
  if (done) done();
};

/**
 * check-all-by-address returns chain and status objects in an array.
 */
const assertLookupAll = (
  err: Error | null,
  res: Response,
  expectedAddress: string,
  expectedChainIds: {
    chainId: string;
    status: string;
    isProxy?: boolean;
    proxyType?: ProxyType | null;
    implementations?: { address: string; name?: string }[];
    proxyResolutionError?: string;
  }[],
  done?: Done,
) => {
  chai.expect(err).to.be.null;
  chai.expect(res.status).to.equal(StatusCodes.OK);
  const resultArray = res.body;
  chai.expect(resultArray).to.have.a.lengthOf(1);
  const result = resultArray[0];
  chai.expect(result.address).to.equal(expectedAddress);
  // Assert warning in each chainId entry
  result.chainIds.forEach(({ warning }: { warning: string }) => {
    chai.expect(warning).to.equal(CHECK_ENDPOINTS_DEPRECATION_WARNING);
  });
  // Compare chainId entries without the warning field
  const chainIdsWithoutWarning = result.chainIds.map(
    ({ warning: _w, ...rest }: Record<string, unknown>) => rest,
  );
  chai.expect(chainIdsWithoutWarning).to.deep.equal(expectedChainIds);
  if (done) done();
};

describe("/check-by-addresses", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();

  it("should fail for missing chainIds", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-by-addresses")
      .query({ addresses: chainFixture.defaultContractAddress })
      .end((err, res) => {
        assertValidationError(err, res, "chainIds");
        done();
      });
  });

  it("should fail for missing addresses", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-by-addresses")
      .query({ chainIds: 1 })
      .end((err, res) => {
        assertValidationError(err, res, "addresses");
        done();
      });
  });

  it("should return false for previously unverified contract", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-by-addresses")
      .query({
        chainIds: chainFixture.chainId,
        addresses: chainFixture.defaultContractAddress,
      })
      .end((err, res) => {
        assertLookup(err, res, chainFixture.defaultContractAddress, "false");
        done();
      });
  });

  it("should fail for invalid address", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-by-addresses")
      .query({ chainIds: chainFixture.chainId, addresses: invalidAddress })
      .end((err, res) => {
        assertValidationError(err, res, "addresses");
        done();
      });
  });

  it("should return false for unverified contract but then perfect after verification", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-by-addresses")
      .query({
        chainIds: chainFixture.chainId,
        addresses: chainFixture.defaultContractAddress,
      })
      .end((err, res) => {
        assertLookup(err, res, chainFixture.defaultContractAddress, "false");
        chai
          .request(serverFixture.server.app)
          .post("/")
          .field("address", chainFixture.defaultContractAddress)
          .field("chain", chainFixture.chainId)
          .attach(
            "files",
            chainFixture.defaultContractMetadata,
            "metadata.json",
          )
          .attach("files", chainFixture.defaultContractSource)
          .end((err, res) => {
            chai.expect(err).to.be.null;
            chai.expect(res.status).to.equal(StatusCodes.OK);

            chai
              .request(serverFixture.server.app)
              .get("/check-by-addresses")
              .query({
                chainIds: chainFixture.chainId,
                addresses: chainFixture.defaultContractAddress,
              })
              .end((err, res) =>
                assertLookup(
                  err,
                  res,
                  chainFixture.defaultContractAddress,
                  "perfect",
                  done,
                ),
              );
          });
      });
  });

  it("should convert addresses to checksummed format", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-by-addresses")
      .query({
        chainIds: chainFixture.chainId,
        addresses: chainFixture.defaultContractAddress.toLowerCase(),
      })
      .end((err, res) => {
        assertLookup(
          err,
          res,
          chainFixture.defaultContractAddress,
          "false",
          done,
        );
      });
  });
});

describe("/check-all-by-addresses", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it("should fail for missing chainIds", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-all-by-addresses")
      .query({ addresses: chainFixture.defaultContractAddress })
      .end((err, res) => {
        assertValidationError(err, res, "chainIds");
        done();
      });
  });

  it("should fail for missing addresses", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-all-by-addresses")
      .query({ chainIds: 1 })
      .end((err, res) => {
        assertValidationError(err, res, "addresses");
        done();
      });
  });

  it("should return false for previously unverified contract", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-all-by-addresses")
      .query({
        chainIds: chainFixture.chainId,
        addresses: chainFixture.defaultContractAddress,
      })
      .end((err, res) =>
        assertLookup(
          err,
          res,
          chainFixture.defaultContractAddress,
          "false",
          done,
        ),
      );
  });

  it("should fail for invalid address", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-all-by-addresses")
      .query({ chainIds: chainFixture.chainId, addresses: invalidAddress })
      .end((err, res) => {
        assertValidationError(err, res, "addresses");
        done();
      });
  });

  it("should return false for unverified contract but then perfect after verification", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-all-by-addresses")
      .query({
        chainIds: chainFixture.chainId,
        addresses: chainFixture.defaultContractAddress,
      })
      .end((err, res) => {
        assertLookup(err, res, chainFixture.defaultContractAddress, "false");
        chai
          .request(serverFixture.server.app)
          .post("/")
          .field("address", chainFixture.defaultContractAddress)
          .field("chain", chainFixture.chainId)
          .attach(
            "files",
            chainFixture.defaultContractMetadata,
            "metadata.json",
          )
          .attach("files", chainFixture.defaultContractSource)
          .end((err, res) => {
            chai.expect(err).to.be.null;
            chai.expect(res.status).to.equal(StatusCodes.OK);

            chai
              .request(serverFixture.server.app)
              .get("/check-all-by-addresses")
              .query({
                chainIds: chainFixture.chainId,
                addresses: chainFixture.defaultContractAddress,
              })
              .end((err, res) =>
                assertLookupAll(
                  err,
                  res,
                  chainFixture.defaultContractAddress,
                  [{ chainId: chainFixture.chainId, status: "perfect" }],
                  done,
                ),
              );
          });
      });
  });

  it("should convert addresses to checksummed format", (done) => {
    chai
      .request(serverFixture.server.app)
      .get("/check-all-by-addresses")
      .query({
        chainIds: chainFixture.chainId,
        addresses: chainFixture.defaultContractAddress.toLowerCase(),
      })
      .end((err, res) => {
        chai.expect(err).to.be.null;
        chai.expect(res.status).to.equal(StatusCodes.OK);
        chai.expect(res.body).to.have.a.lengthOf(1);
        const result = res.body[0];
        chai
          .expect(result.address)
          .to.equal(chainFixture.defaultContractAddress);
        chai.expect(result.status).to.equal("false");
        done();
      });
  });

  describe("proxy detection", () => {
    it("should not return proxy status if contract is not verified", (done) => {
      chai
        .request(serverFixture.server.app)
        .get("/check-all-by-addresses")
        .query({
          chainIds: chainFixture.chainId,
          addresses: chainFixture.defaultContractAddress,
          resolveProxies: "true",
        })
        .end((err, res) => {
          assertLookup(err, res, chainFixture.defaultContractAddress, "false");
          done();
        });
    });

    it("should correctly detect non-proxy contracts", (done) => {
      chai
        .request(serverFixture.server.app)
        .post("/")
        .field("address", chainFixture.defaultContractAddress)
        .field("chain", chainFixture.chainId)
        .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
        .attach("files", chainFixture.defaultContractSource)
        .end((err, res) => {
          chai.expect(err).to.be.null;
          chai.expect(res.status).to.equal(StatusCodes.OK);

          chai
            .request(serverFixture.server.app)
            .get("/check-all-by-addresses")
            .query({
              chainIds: chainFixture.chainId,
              addresses: chainFixture.defaultContractAddress,
              resolveProxies: "true",
            })
            .end((err, res) =>
              assertLookupAll(
                err,
                res,
                chainFixture.defaultContractAddress,
                [
                  {
                    chainId: chainFixture.chainId,
                    status: "perfect",
                    isProxy: false,
                    proxyType: null,
                    implementations: [],
                  },
                ],
                done,
              ),
            );
        });
    });

    it("should correctly detect proxy contracts", async () => {
      const proxyArtifact = (
        await import("../../../testcontracts/Proxy/Proxy_flattened.json")
      ).default;
      const proxyMetadata = (
        await import("../../../testcontracts/Proxy/metadata.json")
      ).default;
      const proxySource = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "testcontracts",
          "Proxy",
          "Proxy_flattened.sol",
        ),
      );

      const logicAddress = chainFixture.defaultContractAddress;

      const contractAddress = await deployFromAbiAndBytecode(
        chainFixture.localSigner,
        proxyArtifact.abi,
        proxyArtifact.bytecode,
        [logicAddress, chainFixture.localSigner.address, "0x"],
      );

      let res = await chai
        .request(serverFixture.server.app)
        .post("/")
        .field("address", contractAddress)
        .field("chain", chainFixture.chainId)
        .attach(
          "files",
          Buffer.from(JSON.stringify(proxyMetadata)),
          "metadata.json",
        )
        .attach("files", proxySource, "Proxy_flattened.sol");

      chai.expect(res.status).to.equal(StatusCodes.OK);

      res = await chai
        .request(serverFixture.server.app)
        .get("/check-all-by-addresses")
        .query({
          chainIds: chainFixture.chainId,
          addresses: contractAddress,
          resolveProxies: "true",
        });

      assertLookupAll(null, res, contractAddress, [
        {
          chainId: chainFixture.chainId,
          status: "perfect",
          isProxy: true,
          proxyType: "EIP1967Proxy",
          implementations: [{ address: logicAddress }],
        },
      ]);
    });

    it("should show an error if the proxy resolution fails", async () => {
      const errorMessage = "Proxy resolution failed";
      sandbox
        .stub(proxyContractUtil, "detectAndResolveProxy")
        .throws(new Error(errorMessage));

      const proxyArtifact = (
        await import("../../../testcontracts/Proxy/Proxy_flattened.json")
      ).default;
      const proxyMetadata = (
        await import("../../../testcontracts/Proxy/metadata.json")
      ).default;
      const proxySource = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "testcontracts",
          "Proxy",
          "Proxy_flattened.sol",
        ),
      );

      const logicAddress = chainFixture.defaultContractAddress;

      const contractAddress = await deployFromAbiAndBytecode(
        chainFixture.localSigner,
        proxyArtifact.abi,
        proxyArtifact.bytecode,
        [logicAddress, chainFixture.localSigner.address, "0x"],
      );

      let res = await chai
        .request(serverFixture.server.app)
        .post("/")
        .field("address", contractAddress)
        .field("chain", chainFixture.chainId)
        .attach(
          "files",
          Buffer.from(JSON.stringify(proxyMetadata)),
          "metadata.json",
        )
        .attach("files", proxySource, "Proxy_flattened.sol");

      chai.expect(res.status).to.equal(StatusCodes.OK);

      res = await chai
        .request(serverFixture.server.app)
        .get("/check-all-by-addresses")
        .query({
          chainIds: chainFixture.chainId,
          addresses: contractAddress,
          resolveProxies: "true",
        });

      assertLookupAll(null, res, contractAddress, [
        {
          chainId: chainFixture.chainId,
          status: "perfect",
          proxyResolutionError: errorMessage,
        },
      ]);
    });
  });
});
