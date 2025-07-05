import chai from "chai";
import chaiHttp from "chai-http";
import {
  deployFromAbiAndBytecode,
  DeploymentInfo,
  verifyContract,
} from "../../../helpers/helpers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import type { Response } from "superagent";
import path from "path";
import fs from "fs";
import { getAddress } from "ethers";
import Sinon from "sinon";
import * as proxyContractUtil from "../../../../src/server/services/utils/proxy-contract-util";

chai.use(chaiHttp);

describe("GET /v2/contract/:chainId/:address", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();
  const sandbox = Sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  const optionalFields = [
    "creationBytecode",
    "runtimeBytecode",
    "deployment",
    "sources",
    "compilation",
    "abi",
    "metadata",
    "storageLayout",
    "userdoc",
    "devdoc",
    "sourceIds",
    "stdJsonInput",
    "stdJsonOutput",
    "proxyResolution",
  ];

  const assertGetContractResponse = (
    res: Response,
    deploymentInfo: DeploymentInfo,
    requestedFields: string[] = [],
    hasCreationMatch: boolean = true,
  ) => {
    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.include({
      match: "exact_match",
      creationMatch: hasCreationMatch ? "exact_match" : null,
      runtimeMatch: "exact_match",
      chainId: chainFixture.chainId,
      address: deploymentInfo.contractAddress,
      matchId: "1",
    });
    chai.expect(res.body).to.have.property("verifiedAt");
    const requestedPrimaryFields = requestedFields.map(
      (field) => field.split(".")[0],
    );
    const unexpectedFields = optionalFields.filter(
      (field) => !requestedPrimaryFields.includes(field),
    );
    if (unexpectedFields.length > 0) {
      chai.expect(res.body).to.not.have.any.keys(unexpectedFields);
    }
    const contractPath = Object.keys(
      chainFixture.defaultContractMetadataObject.settings.compilationTarget,
    )[0];
    const compilerSettings = {
      ...chainFixture.defaultContractMetadataObject.settings,
    } as Partial<typeof chainFixture.defaultContractMetadataObject.settings>;
    delete compilerSettings.compilationTarget;

    for (const field of requestedFields) {
      const splitField = field.split(".");
      if (splitField.length > 2) {
        throw new Error(
          "Malformed test. Fields should not have more than two parts.",
        );
      }
      const [primaryField, subField] = splitField;
      let objectToExpect: any;
      switch (primaryField) {
        case "creationBytecode":
          objectToExpect = {
            onchainBytecode: chainFixture.defaultContractArtifact.bytecode,
            recompiledBytecode: chainFixture.defaultContractArtifact.bytecode,
            sourceMap: chainFixture.defaultContractArtifact.sourceMap,
            linkReferences: chainFixture.defaultContractArtifact.linkReferences,
            cborAuxdata: chainFixture.defaultContractArtifact.cborAuxdata,
            transformations: [],
            transformationValues: {},
          };
          break;
        case "runtimeBytecode":
          objectToExpect = {
            onchainBytecode:
              chainFixture.defaultContractArtifact.deployedBytecode,
            recompiledBytecode:
              chainFixture.defaultContractArtifact.deployedBytecode,
            sourceMap: chainFixture.defaultContractArtifact.deployedSourceMap,
            linkReferences:
              chainFixture.defaultContractArtifact.deployedLinkReferences,
            cborAuxdata:
              chainFixture.defaultContractArtifact.deployedCborAuxdata,
            immutableReferences:
              chainFixture.defaultContractArtifact.immutableReferences,
            transformations: [],
            transformationValues: {},
          };
          break;
        case "deployment":
          objectToExpect = {
            transactionHash: deploymentInfo.txHash,
            blockNumber: deploymentInfo.blockNumber.toString(),
            transactionIndex: deploymentInfo.txIndex.toString(),
            deployer: getAddress(chainFixture.localSigner.address),
          };
          break;
        case "sources":
          if (subField) {
            throw new Error(
              "Malformed test. Sources should not have subfields.",
            );
          }
          objectToExpect = {
            [contractPath]: {
              content: chainFixture.defaultContractSource.toString(),
            },
          };
          break;
        case "compilation":
          objectToExpect = {
            language: chainFixture.defaultContractMetadataObject.language,
            compiler: chainFixture.defaultContractArtifact.compiler.name,
            compilerVersion:
              chainFixture.defaultContractMetadataObject.compiler.version,
            compilerSettings,
            name: chainFixture.defaultContractArtifact.contractName,
            fullyQualifiedName: `${contractPath}:${chainFixture.defaultContractArtifact.contractName}`,
          };
          break;
        case "abi":
          if (subField) {
            throw new Error("Malformed test. ABI should not have subfields.");
          }
          objectToExpect =
            chainFixture.defaultContractMetadataObject.output.abi;
          break;
        case "metadata":
          if (subField) {
            throw new Error(
              "Malformed test. Metadata should not have subfields.",
            );
          }
          objectToExpect = chainFixture.defaultContractMetadataObject;
          break;
        case "storageLayout":
          if (subField) {
            throw new Error(
              "Malformed test. StorageLayout should not have subfields.",
            );
          }
          objectToExpect = chainFixture.defaultContractArtifact.storageLayout;
          break;
        case "userdoc":
          if (subField) {
            throw new Error(
              "Malformed test. Userdoc should not have subfields.",
            );
          }
          objectToExpect = chainFixture.defaultContractArtifact.userdoc;
          break;
        case "devdoc":
          if (subField) {
            throw new Error(
              "Malformed test. Devdoc should not have subfields.",
            );
          }
          objectToExpect = chainFixture.defaultContractArtifact.devdoc;
          break;
        case "sourceIds":
          if (subField) {
            throw new Error(
              "Malformed test. SourceIds should not have subfields.",
            );
          }
          objectToExpect = { [contractPath]: { id: 0 } };
          break;
        case "stdJsonInput":
          if (subField) {
            throw new Error(
              "Malformed test. StdJsonInput should not have subfields.",
            );
          }
          objectToExpect = {
            language: chainFixture.defaultContractMetadataObject.language,
            sources: {
              [contractPath]: {
                content: chainFixture.defaultContractSource.toString(),
              },
            },
            settings: compilerSettings,
          };
          break;
        case "stdJsonOutput":
          if (subField) {
            throw new Error(
              "Malformed test. StdJsonOutput should not have subfields.",
            );
          }
          objectToExpect = {
            sources: { [contractPath]: { id: 0 } },
            contracts: {
              [contractPath]: {
                [chainFixture.defaultContractArtifact.contractName]: {
                  abi: chainFixture.defaultContractMetadataObject.output.abi,
                  metadata: chainFixture.defaultContractArtifact.metadata,
                  userdoc: chainFixture.defaultContractArtifact.userdoc,
                  devdoc: chainFixture.defaultContractArtifact.devdoc,
                  storageLayout:
                    chainFixture.defaultContractArtifact.storageLayout,
                  evm: {
                    bytecode: {
                      object: chainFixture.defaultContractArtifact.bytecode,
                      sourceMap: chainFixture.defaultContractArtifact.sourceMap,
                      linkReferences:
                        chainFixture.defaultContractArtifact.linkReferences,
                    },
                    deployedBytecode: {
                      object:
                        chainFixture.defaultContractArtifact.deployedBytecode,
                      sourceMap:
                        chainFixture.defaultContractArtifact.deployedSourceMap,
                      linkReferences:
                        chainFixture.defaultContractArtifact
                          .deployedLinkReferences,
                      immutableReferences:
                        chainFixture.defaultContractArtifact
                          .immutableReferences,
                    },
                  },
                },
              },
            },
          };
          break;
        case "proxyResolution":
          if (subField) {
            throw new Error(
              "Malformed test. ProxyResolution should not have subfields.",
            );
          }
          objectToExpect = {
            isProxy: false,
            proxyType: null,
            implementations: [],
          };
          break;
        default:
          throw new Error("Malformed test. Unknown field.");
      }
      if (subField) {
        chai
          .expect(res.body)
          .to.have.deep.nested.property(field, objectToExpect[subField]);
      } else {
        chai
          .expect(res.body)
          .to.have.deep.property(primaryField, objectToExpect);
      }
    }
  };

  it("should return minimal information for a verified contract by default", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo);
  });

  it("should return creationBytecode information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=creationBytecode`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "creationBytecode",
    ]);
  });

  it("should return runtimeBytecode information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=runtimeBytecode`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "runtimeBytecode",
    ]);
  });

  it("should return deployment information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=deployment`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "deployment",
    ]);
  });

  it("should return sources information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=sources`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "sources",
    ]);
  });

  it("should return compilation information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=compilation`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "compilation",
    ]);
  });

  it("should return abi information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=abi`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "abi",
    ]);
  });

  it("should return metadata information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=metadata`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "metadata",
    ]);
  });

  it("should return storageLayout information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=storageLayout`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "storageLayout",
    ]);
  });

  it("should return userdoc information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=userdoc`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "userdoc",
    ]);
  });

  it("should return devdoc information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=devdoc`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "devdoc",
    ]);
  });

  it("should return sourceIds information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=sourceIds`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "sourceIds",
    ]);
  });

  it("should return stdJsonInput information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=stdJsonInput`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "stdJsonInput",
    ]);
  });

  it("should return stdJsonOutput information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=stdJsonOutput`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "stdJsonOutput",
    ]);
  });

  it("should return proxyResolution information when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=proxyResolution`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "proxyResolution",
    ]);
  });

  it("should correctly detect proxy contracts", async function () {
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
    chai.expect(res.status).to.equal(200);

    res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${contractAddress}?fields=proxyResolution`,
      );

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.have.deep.property("proxyResolution", {
      isProxy: true,
      proxyType: "EIP1967Proxy",
      implementations: [{ address: logicAddress }],
    });
  });

  it("should show an error if the proxy resolution fails", async () => {
    sandbox
      .stub(proxyContractUtil, "detectAndResolveProxy")
      .throws(new Error("Proxy resolution failed"));

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

    chai.expect(res.status).to.equal(200);

    res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${contractAddress}?fields=proxyResolution`,
      );

    chai.expect(res.status).to.equal(200);
    chai
      .expect(res.body.proxyResolution.proxyResolutionError.customCode)
      .to.equal("proxy_resolution_error");
    chai
      .expect(res.body.proxyResolution.proxyResolutionError)
      .to.have.property("message");
    chai
      .expect(res.body.proxyResolution.proxyResolutionError)
      .to.have.property("errorId");
    chai
      .expect(res.body.proxyResolution)
      .to.not.have.property("implementations");
    chai.expect(res.body.proxyResolution).to.not.have.property("isProxy");
    chai.expect(res.body.proxyResolution).to.not.have.property("proxyType");
  });

  it("should return all fields when requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=${optionalFields.join(",")}`,
      );

    assertGetContractResponse(
      res,
      chainFixture.defaultContractDeploymentInfo,
      optionalFields,
    );
  });

  it("should support a special field 'all' for returning all fields", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=all`,
      );

    assertGetContractResponse(
      res,
      chainFixture.defaultContractDeploymentInfo,
      optionalFields,
    );
  });

  it("should return all fields but the omitted ones when requested", async function () {
    const omittedFields = ["proxyResolution", "deployment"];

    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?omit=${omittedFields.join(",")}`,
      );

    assertGetContractResponse(
      res,
      chainFixture.defaultContractDeploymentInfo,
      optionalFields.filter((field) => !omittedFields.includes(field)),
    );
  });

  it("should allow for selecting subproperties of a field", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=creationBytecode.sourceMap,creationBytecode.onchainBytecode`,
      );

    assertGetContractResponse(res, chainFixture.defaultContractDeploymentInfo, [
      "creationBytecode.sourceMap",
      "creationBytecode.onchainBytecode",
    ]);
  });

  it("should allow for deselecting subproperties of a field", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?omit=deployment.transactionHash,deployment.blockNumber`,
      );

    assertGetContractResponse(
      res,
      chainFixture.defaultContractDeploymentInfo,
      optionalFields
        .filter((field) => field !== "deployment")
        .concat(["deployment.transactionIndex", "deployment.deployer"]),
    );
  });

  it("should return minimal information for a contract for which no creation code is stored", async function () {
    // Random tx hash to make sure creation code cannot be found
    await verifyContract(
      serverFixture,
      chainFixture,
      undefined,
      "0x60b6dcfac48e31ebdba02f8b32759b66d2593ffa00b763761a22e25d55ace14e",
    );

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
      );

    assertGetContractResponse(
      res,
      chainFixture.defaultContractDeploymentInfo,
      [],
      false,
    );
  });

  it("should return minimal information for a contract for which no deployer is stored", async function () {
    await verifyContract(serverFixture, chainFixture);

    await serverFixture.sourcifyDatabase.query(
      `UPDATE contract_deployments SET deployer = NULL WHERE address = $1`,
      [Buffer.from(chainFixture.defaultContractAddress.substring(2), "hex")],
    );

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=deployment.deployer`,
      );

    chai.expect(res.status).to.equal(200);
    chai.expect(res.body).to.include({
      match: "exact_match",
      creationMatch: "exact_match",
      runtimeMatch: "exact_match",
      chainId: chainFixture.chainId,
      address: chainFixture.defaultContractAddress,
      matchId: "1",
    });
    chai.expect(res.body).to.have.property("verifiedAt");

    chai.expect(res.body.deployment.deployer).to.equal(null);
  });

  it("should return a 400 when unknown fields are requested", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=unknown`,
      );

    chai.expect(res.status).to.equal(400);
    chai.expect(res.body.customCode).to.equal("invalid_parameter");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });

  it("should return a 400 when unknown fields should be omitted", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?omit=unknown`,
      );

    chai.expect(res.status).to.equal(400);
    chai.expect(res.body.customCode).to.equal("invalid_parameter");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });

  it("should return a 400 when omit and fields parameters are provided at the same time", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?omit=userdoc&fields=creationBytecode`,
      );

    chai.expect(res.status).to.equal(400);
    chai.expect(res.body.customCode).to.equal("invalid_parameter");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });

  it("should return a 400 when 'all' is used with another field", async function () {
    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=all,creationBytecode`,
      );

    chai.expect(res.status).to.equal(400);
    chai.expect(res.body.customCode).to.equal("invalid_parameter");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });

  it("should return a 400 when invalid subproperties for fields are selected", async function () {
    await verifyContract(serverFixture, chainFixture);

    let res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=abi.name`,
      );

    chai.expect(res.status).to.equal(400);
    chai.expect(res.body.customCode).to.equal("invalid_parameter");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");

    res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?omit=sources.Storage`,
      );

    chai.expect(res.status).to.equal(400);
    chai.expect(res.body.customCode).to.equal("invalid_parameter");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");

    res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${chainFixture.defaultContractAddress}?fields=creationBytecode.onchainBytecode.linkReferences`,
      );

    chai.expect(res.status).to.equal(400);
    chai.expect(res.body.customCode).to.equal("invalid_parameter");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });

  it("should return a 404 when the chain is not found", async function () {
    const unknownChainId = "5";
    const chainMap = serverFixture.server.chainRepository.sourcifyChainMap;
    sandbox.stub(chainMap, unknownChainId).value(undefined);

    await verifyContract(serverFixture, chainFixture);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${unknownChainId}/${chainFixture.defaultContractAddress}`,
      );

    chai.expect(res.status).to.equal(404);
    chai.expect(res.body.customCode).to.equal("unsupported_chain");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });

  it("should return a 400 when the address has the wrong length", async function () {
    const wrongLengthAddress = "0xabc";

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/contract/${chainFixture.chainId}/${wrongLengthAddress}`);

    chai.expect(res.status).to.equal(400);
    chai.expect(res.body.customCode).to.equal("invalid_parameter");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });

  it("should return a 400 when the address is invalid", async function () {
    const invalidAddress =
      chainFixture.defaultContractAddress.slice(0, 41) + "G";

    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/contract/${chainFixture.chainId}/${invalidAddress}`);

    chai.expect(res.status).to.equal(400);
    chai.expect(res.body.customCode).to.equal("invalid_parameter");
    chai.expect(res.body).to.have.property("errorId");
    chai.expect(res.body).to.have.property("message");
  });

  it("should return a 404 when the contract is not verified", async function () {
    const contractAddress = "0x0000000000000000000000000000000000000000";
    const res = await chai
      .request(serverFixture.server.app)
      .get(`/v2/contract/${chainFixture.chainId}/${contractAddress}`);

    chai.expect(res.status).to.equal(404);
    chai.expect(res.body).to.deep.equal({
      match: null,
      creationMatch: null,
      runtimeMatch: null,
      chainId: chainFixture.chainId,
      address: contractAddress,
    });
  });

  it("should not return any additional information when the contract is not verified even though all fields are requested", async function () {
    const contractAddress = "0x0000000000000000000000000000000000000000";
    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/v2/contract/${chainFixture.chainId}/${contractAddress}?fields=all`,
      );

    chai.expect(res.status).to.equal(404);
    chai.expect(res.body).to.deep.equal({
      match: null,
      creationMatch: null,
      runtimeMatch: null,
      chainId: chainFixture.chainId,
      address: contractAddress,
    });
  });
});
