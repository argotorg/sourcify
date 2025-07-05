import {
  assertValidationError,
  assertVerificationSession,
} from "../../../helpers/assertions";
import chai from "chai";
import chaiHttp from "chai-http";
import { StatusCodes } from "http-status-codes";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import type { Response } from "superagent";
import path from "path";
import fs from "fs";
import {
  deployFromAbiAndBytecodeForCreatorTxHash,
  deployFromAbiAndBytecode,
  callContractMethodWithTx,
} from "../../../helpers/helpers";
import type { MissingSources } from "@ethereum-sourcify/lib-sourcify";
import { MAX_SESSION_SIZE } from "../../../../src/server/apiv1/verification/verification.common";

chai.use(chaiHttp);

const assertAddressAndChainMissing = (
  res: Response,
  expectedFound: string[],
  expectedMissing: MissingSources,
) => {
  chai.expect(res.status).to.equal(StatusCodes.OK);
  const contracts = res.body.contracts;
  chai.expect(contracts).to.have.a.lengthOf(1);

  const contract = contracts[0];
  chai.expect(contract.status).to.equal("error");
  chai.expect(contract.files.missing).to.deep.equal(expectedMissing);
  chai.expect(contract.files.found).to.deep.equal(expectedFound);
  chai.expect(res.body.unused).to.be.empty;
  chai.expect(contract.storageTimestamp).to.equal(undefined);
  return contracts;
};

describe("/session", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();

  it("should store session in database", async () => {
    await serverFixture.sourcifyDatabase.query("TRUNCATE TABLE session;");
    await chai.request(serverFixture.server.app).post("/session/data").send({});
    const res = await serverFixture.sourcifyDatabase.query(
      "SELECT * FROM session;",
    );
    chai.expect(res?.rowCount).to.equal(1);
  });

  it("should inform when no pending contracts", (done) => {
    chai
      .request(serverFixture.server.app)
      .post("/session/verify-validated")
      .send({})
      .end((err, res) => {
        chai.expect(err).to.be.null;
        chai.expect(res.body).to.haveOwnProperty("error");
        chai.expect(res.status).to.equal(StatusCodes.BAD_REQUEST);
        chai
          .expect(res.body.error)
          .to.equal("There are currently no pending contracts.");
        done();
      });
  });

  it("should accept file upload in JSON format", (done) => {
    chai
      .request(serverFixture.server.app)
      .post("/session/input-files")
      .send({
        files: {
          "metadata.json": chainFixture.defaultContractMetadata.toString(),
          "Storage.sol": chainFixture.defaultContractSource.toString(),
        },
      })
      .then((res) => {
        assertAddressAndChainMissing(
          res,
          ["project:/contracts/Storage.sol"],
          {},
        );
        done();
      });
  });

  it("should not verify after addition of metadata+source, but should after providing address+chainId", (done) => {
    const agent = chai.request.agent(serverFixture.server.app);
    agent
      .post("/session/input-files")
      .attach("files", chainFixture.defaultContractSource, "Storage.sol")
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .then((res) => {
        const contracts = assertAddressAndChainMissing(
          res,
          ["project:/contracts/Storage.sol"],
          {},
        );
        contracts[0].address = chainFixture.defaultContractAddress;
        contracts[0].chainId = chainFixture.chainId;

        agent
          .post("/session/verify-validated")
          .send({ contracts })
          .end(async (err, res) => {
            await assertVerificationSession(
              serverFixture,
              err,
              res,
              done,
              chainFixture.defaultContractAddress,
              chainFixture.chainId,
              "perfect",
            );
          });
      });
  });

  const assertAfterMetadataUpload = (err: Error | null, res: Response) => {
    chai.expect(err).to.be.null;
    chai.expect(res.status).to.equal(StatusCodes.OK);
    chai.expect(res.body.unused).to.be.empty;

    const contracts = res.body.contracts;
    chai.expect(contracts).to.have.a.lengthOf(1);
    const contract = contracts[0];

    chai.expect(contract.name).to.equal("Storage");
    chai.expect(contract.status).to.equal("error");
  };

  it("should not verify when session cookie not stored clientside", (done) => {
    chai
      .request(serverFixture.server.app)
      .post("/session/input-files")
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .end((err, res) => {
        assertAfterMetadataUpload(err, res);

        chai
          .request(serverFixture.server.app)
          .post("/session/input-files")
          .attach("files", chainFixture.defaultContractSource, "Storage.sol")
          .end((err, res) => {
            chai.expect(err).to.be.null;
            chai.expect(res.status).to.equal(StatusCodes.OK);

            chai.expect(res.body.unused).to.deep.equal(["Storage.sol"]);
            chai.expect(res.body.contracts).to.be.empty;
            done();
          });
      });
  });

  it("should verify when session cookie stored clientside", (done) => {
    const agent = chai.request.agent(serverFixture.server.app);
    agent
      .post("/session/input-files")
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .end((err, res) => {
        assertAfterMetadataUpload(err, res);
        const contracts = res.body.contracts;

        agent
          .post("/session/input-files")
          .attach("files", chainFixture.defaultContractSource, "Storage.sol")
          .end((err, res) => {
            contracts[0].chainId = chainFixture.chainId;
            contracts[0].address = chainFixture.defaultContractAddress;
            assertVerificationSession(
              serverFixture,
              err,
              res,
              null,
              undefined,
              undefined,
              "error",
            ).then(() => {
              agent
                .post("/session/verify-validated")
                .send({ contracts })
                .end(async (err, res) => {
                  await assertVerificationSession(
                    serverFixture,
                    err,
                    res,
                    done,
                    chainFixture.defaultContractAddress,
                    chainFixture.chainId,
                    "perfect",
                  );
                });
            });
          });
      });
  });

  it("should fail with HTTP 413 if a file above max server file size is uploaded", (done) => {
    const agent = chai.request.agent(serverFixture.server.app);
    const file = "a".repeat(serverFixture.maxFileSize + 1);
    agent
      .post("/session/input-files")
      .attach("files", Buffer.from(file))
      .then((res) => {
        chai.expect(res.status).to.equal(StatusCodes.REQUEST_TOO_LONG);
        done();
      });
  });

  it("should fail if too many files uploaded, but should succeed after deletion", async () => {
    const agent = chai.request.agent(serverFixture.server.app);
    let res;
    const maxNumMaxFiles = Math.floor(
      MAX_SESSION_SIZE / serverFixture.maxFileSize,
    ); // Max number of max size files allowed in a session
    const file = "a".repeat((serverFixture.maxFileSize * 3) / 4); // because of base64 encoding which increases size by 1/3, making it 4/3 of the original
    for (let i = 0; i < maxNumMaxFiles; i++) {
      // Should be allowed each time
      res = await agent
        .post("/session/input-files")
        .attach("files", Buffer.from(file));
      chai.expect(res.status).to.equal(StatusCodes.OK);
    }
    // Should exceed size this time
    res = await agent
      .post("/session/input-files")
      .attach("files", Buffer.from(file));
    chai.expect(res.status).to.equal(StatusCodes.REQUEST_TOO_LONG);
    chai.expect(res.body.error).to.exist;
    // Should be back to normal
    res = await agent.post("/session/clear");
    chai.expect(res.status).to.equal(StatusCodes.OK);
    res = await agent
      .post("/session/input-files")
      .attach("files", Buffer.from("a"));
    chai.expect(res.status).to.equal(StatusCodes.OK);
    console.log("done");
  });

  const assertSingleContractStatus = (
    res: Response,
    expectedStatus: string,
    shouldHaveTimestamp?: boolean,
  ) => {
    chai.expect(res.status).to.equal(StatusCodes.OK);
    chai.expect(res.body).to.haveOwnProperty("contracts");
    const contracts = res.body.contracts;
    chai.expect(contracts).to.have.a.lengthOf(1);
    const contract = contracts[0];
    chai.expect(contract.status).to.equal(expectedStatus);
    chai.expect(!!contract.storageTimestamp).to.equal(!!shouldHaveTimestamp);
    return contracts;
  };

  it("should verify after providing address and then network; should provide timestamp when verifying again", (done) => {
    const agent = chai.request.agent(serverFixture.server.app);
    agent
      .post("/session/input-files")
      .attach("files", chainFixture.defaultContractSource)
      .attach("files", chainFixture.defaultContractMetadata)
      .then((res) => {
        const contracts = assertSingleContractStatus(res, "error");
        contracts[0].address = chainFixture.defaultContractAddress;
        // Pass the creatorTxHash to achieve also perfect creation match
        contracts[0].creatorTxHash = chainFixture.defaultContractCreatorTx;
        agent
          .post("/session/verify-validated")
          .send({ contracts })
          .then((res) => {
            assertSingleContractStatus(res, "error");
            contracts[0].chainId = chainFixture.chainId;

            agent
              .post("/session/verify-validated")
              .send({ contracts })
              .then((res) => {
                assertSingleContractStatus(res, "perfect");

                agent
                  .post("/session/verify-validated")
                  .send({ contracts })
                  .then((res) => {
                    assertSingleContractStatus(res, "perfect", true);
                    done();
                  });
              });
          });
      });
  });

  it("should import a contract using /session/input-contract", async () => {
    const agent = chai.request.agent(serverFixture.server.app);
    try {
      const res = await agent.post("/session/input-contract").send({
        address: chainFixture.defaultContractAddress,
        chainId: chainFixture.chainId,
      });
      chai.expect(res.body).to.deep.equal({
        contracts: [
          {
            verificationId: res.body.contracts[0].verificationId,
            compiledPath: "project:/contracts/Storage.sol",
            name: "Storage",
            files: {
              found: ["project:/contracts/Storage.sol"],
              missing: {},
              invalid: {},
            },
            status: "error",
          },
        ],
        unused: [],
        files: ["metadata.json"],
      });
    } catch (e) {
      console.log(e);
    }
  });

  it("should fail for a source that is missing and unfetchable", (done) => {
    const agent = chai.request.agent(serverFixture.server.app);
    agent
      .post("/session/input-files")
      .attach(
        "files",
        Buffer.from(
          JSON.stringify(
            chainFixture.defaultContractMetadataWithModifiedIpfsHash,
          ),
        ),
      )
      .then((res) => {
        assertAddressAndChainMissing(res, [], {
          "project:/contracts/Storage.sol": {
            keccak256:
              "0x88c47206b5ec3d60ab820e9d126c4ac54cb17fa7396ff49ebe27db2862982ad8",
            urls: [
              "bzz-raw://5d1eeb01c8c10bed9e290f4a80a8d4081422a7b298a13049d72867022522cf6b",
              "dweb:/ipfs/QmaFRC9ZtT7y3t9XNWCbDuMTEwKkyaQJzYFzw3NbeohSna", // last char changed to "a"
            ],
          },
        });
        done();
      });
  });

  it("should fetch missing sources", (done) => {
    const agent = chai.request.agent(serverFixture.server.app);
    agent.post("/session/clear").then(() => {
      agent
        .post("/session/input-files")
        .attach("files", chainFixture.defaultContractMetadata)
        .then((res) => {
          assertAddressAndChainMissing(
            res,
            ["project:/contracts/Storage.sol"],
            {},
          );
          done();
        });
    });
  });

  it("should run with dryRun, returning a successfull match but not storing it", function (done) {
    const agent = chai.request.agent(serverFixture.server.app);
    agent
      .post("/session/input-files")
      .attach("files", chainFixture.defaultContractMetadata)
      .then((res) => {
        const contracts = assertAddressAndChainMissing(
          res,
          ["project:/contracts/Storage.sol"],
          {},
        );
        contracts[0].address = chainFixture.defaultContractAddress;
        contracts[0].chainId = chainFixture.chainId;

        const isExist = fs.existsSync(
          path.join(
            serverFixture.repositoryV1Path,
            "contracts",
            "full_match",
            chainFixture.chainId,
            chainFixture.defaultContractAddress,
            "metadata.json",
          ),
        );
        chai.expect(isExist, "File is saved before calling /verify-validated")
          .to.be.false;

        agent
          .post("/session/verify-validated/?dryrun=true")
          .send({ contracts })
          .then((res) => {
            assertSingleContractStatus(res, "perfect");
            const isExist = fs.existsSync(
              path.join(
                serverFixture.repositoryV1Path,
                "contracts",
                "full_match",
                chainFixture.chainId,
                chainFixture.defaultContractAddress,
                "metadata.json",
              ),
            );
            chai.expect(isExist, "File is saved even despite dryRun").to.be
              .false;
            done();
          });
      });
  });

  it("should verify after fetching and then providing address+chainId", (done) => {
    const agent = chai.request.agent(serverFixture.server.app);
    agent
      .post("/session/input-files")
      .attach("files", chainFixture.defaultContractMetadata)
      .then((res) => {
        const contracts = assertAddressAndChainMissing(
          res,
          ["project:/contracts/Storage.sol"],
          {},
        );
        contracts[0].address = chainFixture.defaultContractAddress;
        contracts[0].chainId = chainFixture.chainId;

        agent
          .post("/session/verify-validated")
          .send({ contracts })
          .then((res) => {
            assertSingleContractStatus(res, "perfect");
            done();
          });
      });
  });

  it("should correctly handle when uploaded 0/2 and then 1/2 sources", (done) => {
    const metadataPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "metadata",
      "child-contract.meta.object.json",
    );
    const metadataBuffer = fs.readFileSync(metadataPath);

    const parentPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "contracts",
      "ParentContract.sol",
    );
    const parentBuffer = fs.readFileSync(parentPath);

    const agent = chai.request.agent(serverFixture.server.app);
    agent
      .post("/session/input-files")
      .attach("files", metadataBuffer)
      .then((res) => {
        chai.expect(res.status).to.equal(StatusCodes.OK);
        chai.expect(res.body.contracts).to.have.lengthOf(1);
        chai.expect(res.body.unused).to.be.empty;

        const contract = res.body.contracts[0];
        chai.expect(contract.files.found).to.have.lengthOf(0);
        chai.expect(Object.keys(contract.files.missing)).to.have.lengthOf(2);

        agent
          .post("/session/input-files")
          .attach("files", parentBuffer)
          .then((res) => {
            chai.expect(res.status).to.equal(StatusCodes.OK);
            chai.expect(res.body.contracts).to.have.lengthOf(1);
            chai.expect(res.body.unused).to.be.empty;

            const contract = res.body.contracts[0];
            chai.expect(contract.files.found).to.have.lengthOf(1);
            chai
              .expect(Object.keys(contract.files.missing))
              .to.have.lengthOf(1);

            done();
          });
      });
  });

  it("should find contracts in a zipped Truffle project", (done) => {
    const zippedTrufflePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "truffle",
      "truffle-example.zip",
    );
    const zippedTruffleBuffer = fs.readFileSync(zippedTrufflePath);
    chai
      .request(serverFixture.server.app)
      .post("/session/input-files")
      .attach("files", zippedTruffleBuffer)
      .then((res) => {
        chai.expect(res.status).to.equal(StatusCodes.OK);
        chai.expect(res.body.contracts).to.have.lengthOf(3);
        done();
      });
  });

  it("should correctly handle when uploaded 0/2 and then 1/2 sources", (done) => {
    const metadataPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "metadata",
      "child-contract.meta.object.json",
    );
    const metadataBuffer = fs.readFileSync(metadataPath);

    const parentPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "contracts",
      "ParentContract.sol",
    );
    const parentBuffer = fs.readFileSync(parentPath);

    const agent = chai.request.agent(serverFixture.server.app);
    agent
      .post("/session/input-files")
      .attach("files", metadataBuffer)
      .then((res) => {
        chai.expect(res.status).to.equal(StatusCodes.OK);
        chai.expect(res.body.contracts).to.have.lengthOf(1);
        chai.expect(res.body.unused).to.be.empty;

        const contract = res.body.contracts[0];
        chai.expect(contract.files.found).to.have.lengthOf(0);
        chai.expect(Object.keys(contract.files.missing)).to.have.lengthOf(2);

        agent
          .post("/session/input-files")
          .attach("files", parentBuffer)
          .then((res) => {
            chai.expect(res.status).to.equal(StatusCodes.OK);
            chai.expect(res.body.contracts).to.have.lengthOf(1);
            chai.expect(res.body.unused).to.be.empty;

            const contract = res.body.contracts[0];
            chai.expect(contract.files.found).to.have.lengthOf(1);
            chai
              .expect(Object.keys(contract.files.missing))
              .to.have.lengthOf(1);

            done();
          });
      });
  });

  it("should find contracts in a zipped Truffle project", (done) => {
    const zippedTrufflePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "sources",
      "truffle",
      "truffle-example.zip",
    );
    const zippedTruffleBuffer = fs.readFileSync(zippedTrufflePath);
    chai
      .request(serverFixture.server.app)
      .post("/session/input-files")
      .attach("files", zippedTruffleBuffer)
      .then((res) => {
        chai.expect(res.status).to.equal(StatusCodes.OK);
        chai.expect(res.body.contracts).to.have.lengthOf(3);
        chai.expect(res.body.unused).not.to.be.empty;
        done();
      });
  });

  it("should verify a contract with immutables and save immutable-references.json", async () => {
    const artifact = (
      await import("../../../testcontracts/WithImmutables/artifact.json")
    ).default;
    const { contractAddress } = await deployFromAbiAndBytecodeForCreatorTxHash(
      chainFixture.localSigner,
      artifact.abi,
      artifact.bytecode,
      [999],
    );

    const metadata = (
      await import("../../../testcontracts/WithImmutables/metadata.json")
    ).default;
    const metadataBuffer = Buffer.from(JSON.stringify(metadata));
    const sourcePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "testcontracts",
      "WithImmutables",
      "sources",
      "WithImmutables.sol",
    );
    const sourceBuffer = fs.readFileSync(sourcePath);

    const agent = chai.request.agent(serverFixture.server.app);

    const res1 = await agent
      .post("/session/input-files")
      .attach("files", sourceBuffer)
      .attach("files", metadataBuffer);

    const contracts = assertSingleContractStatus(res1, "error");

    contracts[0].address = contractAddress;
    contracts[0].chainId = chainFixture.chainId;
    const res2 = await agent
      .post("/session/verify-validated")
      .send({ contracts });

    assertSingleContractStatus(res2, "perfect");
    const isExist = fs.existsSync(
      path.join(
        serverFixture.repositoryV1Path,
        "contracts",
        "full_match",
        chainFixture.chainId,
        contractAddress,
        "immutable-references.json",
      ),
    );
    chai.expect(isExist, "Immutable references not saved").to.be.true;
  });

  it("should verify a contract created by a factory contract and has immutables", async () => {
    const deployValue = 12345;

    const artifact = (
      await import("../../../testcontracts/FactoryImmutable/Factory.json")
    ).default;
    const factoryAddress = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      artifact.abi,
      artifact.bytecode,
    );

    // Deploy child by calling deploy(uint)
    const childMetadata = (
      await import(
        "../../../testcontracts/FactoryImmutable/Child_metadata.json"
      )
    ).default;
    const childMetadataBuffer = Buffer.from(JSON.stringify(childMetadata));
    const txReceipt = await callContractMethodWithTx(
      chainFixture.localSigner,
      artifact.abi,
      factoryAddress,
      "deploy",
      [deployValue],
    );

    if (!txReceipt) {
      chai.assert.fail("Didn't get a txReceipt from factory contract call");
    }
    // @ts-ignore
    const childAddress = txReceipt.logs[0].args[0];
    const sourcePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "testcontracts",
      "FactoryImmutable",
      "FactoryTest.sol",
    );
    const sourceBuffer = fs.readFileSync(sourcePath);

    const agent = chai.request.agent(serverFixture.server.app);

    const res1 = await agent
      .post("/session/input-files")
      .attach("files", sourceBuffer)
      .attach("files", childMetadataBuffer);

    const contracts = assertSingleContractStatus(res1, "error");

    contracts[0].address = childAddress;
    contracts[0].chainId = chainFixture.chainId;

    const res = await agent
      .post("/session/verify-validated")
      .send({ contracts });
    assertSingleContractStatus(res, "perfect");
  });

  it("should verify a contract created by a factory contract and has immutables without constructor arguments but with msg.sender assigned immutable", async () => {
    const artifact = (
      await import(
        "../../../testcontracts/FactoryImmutableWithoutConstrArg/Factory3.json"
      )
    ).default;
    const factoryAddress = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      artifact.abi,
      artifact.bytecode,
    );

    // Deploy child by calling deploy(uint)
    const childMetadata = (
      await import(
        "../../../testcontracts/FactoryImmutableWithoutConstrArg/Child3_metadata.json"
      )
    ).default;
    const childMetadataBuffer = Buffer.from(JSON.stringify(childMetadata));
    const txReceipt = await callContractMethodWithTx(
      chainFixture.localSigner,
      artifact.abi,
      factoryAddress,
      "createChild",
      [],
    );

    if (!txReceipt) {
      chai.assert.fail("Didn't get a txReceipt from factory contract call");
    }
    // @ts-ignore
    const childAddress = txReceipt.logs[0].args[0];
    const sourcePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "testcontracts",
      "FactoryImmutableWithoutConstrArg",
      "FactoryTest3.sol",
    );
    const sourceBuffer = fs.readFileSync(sourcePath);

    const agent = chai.request.agent(serverFixture.server.app);

    const res1 = await agent
      .post("/session/input-files")
      .attach("files", sourceBuffer)
      .attach("files", childMetadataBuffer);

    const contracts = assertSingleContractStatus(res1, "error");

    contracts[0].address = childAddress;
    contracts[0].chainId = chainFixture.chainId;
    const res = await agent
      .post("/session/verify-validated")
      .send({ contracts });
    assertSingleContractStatus(res, "perfect");
  });

  it("should return validation error for adding standard input JSON without a compiler version", async () => {
    const agent = chai.request.agent(serverFixture.server.app);

    const solcJsonPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "testcontracts",
      "Storage",
      "StorageJsonInput.json",
    );
    const solcJsonBuffer = fs.readFileSync(solcJsonPath);

    const res = await agent
      .post("/session/input-solc-json")
      .attach("files", solcJsonBuffer);

    assertValidationError(null, res, "body");
  });

  it("should verify a contract with Solidity standard input JSON", async () => {
    const agent = chai.request.agent(serverFixture.server.app);
    const address = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      chainFixture.defaultContractArtifact.abi, // Storage.sol
      chainFixture.defaultContractArtifact.bytecode,
    );
    const solcJsonPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "testcontracts",
      "Storage",
      "StorageJsonInput.json",
    );
    const solcJsonBuffer = fs.readFileSync(solcJsonPath);

    const res = await agent
      .post("/session/input-solc-json")
      .field("compilerVersion", "0.8.4+commit.c7e474f2")
      .attach("files", solcJsonBuffer, "solc.json");

    const contracts = assertSingleContractStatus(res, "error");

    contracts[0].address = address;
    contracts[0].chainId = chainFixture.chainId;

    const res2 = await agent
      .post("/session/verify-validated")
      .send({ contracts });
    assertSingleContractStatus(res2, "perfect");
  });

  it("should store the correct/recompiled metadata file if a wrong metadata input yields a match", async () => {
    // Mimics contract 0x1CA8C2B9B20E18e86d5b9a72370fC6c91814c97C on Optimism (10)
    const artifact = (
      await import(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "testcontracts",
          "ensure-metadata-storage",
          "EIP1967Proxy.json",
        )
      )
    ).default;
    const wrongMetadata = (
      await import(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "testcontracts",
          "ensure-metadata-storage",
          "wrong-metadata.json",
        )
      )
    ).default;
    const correctMetadata = (
      await import(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "testcontracts",
          "ensure-metadata-storage",
          "correct-metadata.json",
        )
      )
    ).default;
    const source1Buffer = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "testcontracts",
        "ensure-metadata-storage",
        "EIP1967Proxy.sol",
      ),
    );
    const source2Buffer = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "testcontracts",
        "ensure-metadata-storage",
        "EIP1967Admin.sol",
      ),
    );
    const contractAddress = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      correctMetadata.output.abi,
      artifact.bytecode,
      [
        "0x39f0bd56c1439a22ee90b4972c16b7868d161981",
        "0x000000000000000000000000000000000000dead",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ],
    );

    const agent = chai.request.agent(serverFixture.server.app);
    const res = await agent
      .post("/session/input-files")
      .attach(
        "files",
        Buffer.from(JSON.stringify(wrongMetadata)),
        "metadata.json",
      );
    const contracts = res.body.contracts;
    await agent
      .post("/session/input-files")
      .attach("files", source1Buffer, "EIP1967Proxy.sol")
      .attach("files", source2Buffer, "EIP1967Admin.sol");

    contracts[0].chainId = chainFixture.chainId;
    contracts[0].address = contractAddress;
    const verifyRes = await agent
      .post("/session/verify-validated")
      .send({ contracts });

    await assertVerificationSession(
      serverFixture,
      null,
      verifyRes,
      null,
      contractAddress,
      chainFixture.chainId,
      "perfect",
    );

    const filesRes = await chai
      .request(serverFixture.server.app)
      .get(`/files/${chainFixture.chainId}/${contractAddress}`);
    const files: Array<Record<string, string>> = filesRes.body;
    const receivedMetadata = files.find(
      (file) => file.name === "metadata.json",
    );
    chai.expect(receivedMetadata).not.to.be.undefined;
    chai
      .expect(receivedMetadata!.content)
      .to.equal(JSON.stringify(correctMetadata));
  });

  // Test also extra-file-bytecode-mismatch via v2 API as well since the workaround is at the API level i.e. VerificationController
  describe("solc v0.6.12 and v0.7.0 extra files in compilation causing metadata match but bytecode mismatch", function () {
    // Deploy the test contract locally
    // Contract from https://explorer.celo.org/address/0x923182024d0Fa5dEe59E3c3db5e2eeD23728D3C3/contracts
    let contractAddress: string;

    before(async () => {
      const bytecodeMismatchArtifact = (
        await import(
          "../../../sources/artifacts/extraFilesBytecodeMismatch.json"
        )
      ).default;
      contractAddress = await deployFromAbiAndBytecode(
        chainFixture.localSigner,
        bytecodeMismatchArtifact.abi,
        bytecodeMismatchArtifact.bytecode,
      );
    });

    it("should warn the user about the issue when metadata match but not bytecodes", (done) => {
      import(
        "../../../sources/hardhat-output/extraFilesBytecodeMismatch-onlyMetadata.json"
      ).then((hardhatOutput) => {
        const hardhatOutputBuffer = Buffer.from(JSON.stringify(hardhatOutput));
        const agent = chai.request.agent(serverFixture.server.app);
        agent
          .post("/session/input-files")
          .attach("files", hardhatOutputBuffer)
          .then((res) => {
            const contracts = res.body.contracts;
            contracts[0].address = contractAddress;
            contracts[0].chainId = chainFixture.chainId;
            agent
              .post("/session/verify-validated")
              .send({ contracts })
              .then((res) => {
                assertSingleContractStatus(res, "error");
                done();
              });
          });
      });
    });

    it("should verify with all input files and not only those in metadata", (done) => {
      import(
        "../../../sources/hardhat-output/extraFilesBytecodeMismatch.json"
      ).then((hardhatOutput) => {
        const hardhatOutputBuffer = Buffer.from(JSON.stringify(hardhatOutput));

        const agent = chai.request.agent(serverFixture.server.app);
        agent
          .post("/session/input-files")
          .attach("files", hardhatOutputBuffer)
          .then((res) => {
            const contracts = res.body.contracts;
            contracts[0].address = contractAddress;
            contracts[0].chainId = chainFixture.chainId;
            agent
              .post("/session/verify-validated")
              .send({ contracts })
              .then((res) => {
                assertSingleContractStatus(res, "perfect");
                done();
              });
          });
      });
    });
  });
});
