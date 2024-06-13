import chai from "chai";
import chaiHttp from "chai-http";
import {
  deployAndVerifyContract,
  deployFromAbiAndBytecode,
  deployFromAbiAndBytecodeForCreatorTxHash,
  waitSecs,
} from "../../helpers/helpers";
import { LocalChainFixture } from "../../helpers/LocalChainFixture";
import { ServerFixture } from "../../helpers/ServerFixture";
import path from "path";
import fs from "fs";

chai.use(chaiHttp);

describe("Verify repository endpoints", function () {
  const chainFixture = new LocalChainFixture();
  const serverFixture = new ServerFixture();

  it("should fetch files of specific address", async function () {
    const agent = chai.request.agent(serverFixture.server.app);
    // Wait for the server to complete the previous contract verification
    await waitSecs(1);
    await agent
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .attach("files", chainFixture.defaultContractSource, "Storage.sol");
    const res0 = await agent.get(
      `/files/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`
    );
    chai.expect(res0.body).to.deep.equal([
      {
        name: "Storage.sol",
        path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
        content: res0.body[0].content,
      },
      {
        name: "metadata.json",
        path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
        content: res0.body[1].content,
      },
    ]);
    const res1 = await agent.get(
      `/files/tree/any/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`
    );
    chai.expect(res1.body).to.deep.equal({
      status: "full",
      files: [
        `http://localhost:10000/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
        `http://localhost:10000contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
      ],
    });
    const res2 = await agent.get(
      `/files/any/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`
    );
    chai.expect(res2.body).to.deep.equal({
      status: "full",
      files: [
        {
          name: "Storage.sol",
          path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
          content: res2.body.files[0].content,
        },
        {
          name: "metadata.json",
          path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
          content: res2.body.files[1].content,
        },
      ],
    });
    const res3 = await agent.get(
      `/files/tree/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`
    );
    chai
      .expect(res3.body)
      .to.deep.equal([
        `http://localhost:10000/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
        `http://localhost:10000contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
      ]);
    const res4 = await agent.get(`/files/contracts/${chainFixture.chainId}`);
    chai.expect(res4.body).to.deep.equal({
      full: [chainFixture.defaultContractAddress],
      partial: [],
    });
  });

  it("should fetch a .sol file of specific address", async function () {
    const agent = chai.request.agent(serverFixture.server.app);
    // Wait for the server to complete the previous contract verification
    await waitSecs(1);
    await agent
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .attach("files", chainFixture.defaultContractSource, "Storage.sol");
    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`
      );
    chai
      .expect(res.text)
      .to.equal(chainFixture.defaultContractSource.toString());
  });

  it("should fetch metadata.json of specific address", async function () {
    const agent = chai.request.agent(serverFixture.server.app);
    // Wait for the server to complete the previous contract verification
    await waitSecs(1);
    await agent
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .attach("files", chainFixture.defaultContractSource, "Storage.sol");
    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`
      );
    chai
      .expect(res.text)
      .to.equal(chainFixture.defaultContractMetadata.toString());

    const res1 = await chai
      .request(serverFixture.server.app)
      .get(
        `/files/any/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`
      );

    const fileToCheck = res1.body.files.find(
      (file: any) => file.name === "metadata.json"
    );
    chai.expect(fileToCheck.content).to.be.a("string");
    chai
      .expect(fileToCheck.content)
      .to.equal(chainFixture.defaultContractMetadata.toString());
  });

  it("should fetch immutable-references.json of specific address, and it should be available in /files/any", async function () {
    const artifact = await import(
      "../../testcontracts/WithImmutables/artifact.json"
    );

    const metadata = await import(
      "../../testcontracts/WithImmutables/metadata.json"
    );
    const metadataBuffer = Buffer.from(JSON.stringify(metadata));
    const sourcePath = path.join(
      __dirname,
      "..",
      "..",
      "testcontracts",
      "WithImmutables",
      "sources",
      "WithImmutables.sol"
    );
    const sourceBuffer = fs.readFileSync(sourcePath);

    const contractAddress = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      artifact.abi,
      artifact.bytecode,
      [999]
    );
    await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", contractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", metadataBuffer, "metadata.json")
      .attach("files", sourceBuffer);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/repository/contracts/full_match/${chainFixture.chainId}/${contractAddress}/immutable-references.json`
      );

    const expectedContent = {
      "3": [
        {
          length: 32,
          start: 608,
        },
      ],
    };
    chai.expect(res.body).to.deep.equal(expectedContent);

    const res1 = await chai
      .request(serverFixture.server.app)
      .get(`/files/any/${chainFixture.chainId}/${contractAddress}`);

    const fileToCheck = res1.body.files.find(
      (file: any) => file.name === "immutable-references.json"
    );
    chai
      .expect(fileToCheck.path)
      .to.equal(
        `contracts/full_match/${chainFixture.chainId}/${contractAddress}/immutable-references.json`
      );
    chai.expect(fileToCheck.content).to.be.a("string");
    chai.expect(JSON.parse(fileToCheck.content)).to.deep.equal(expectedContent);
  });

  it("should fetch library-map.json of specific address, and it should be available in /files/any", async function () {
    const artifact = await import(
      "../../testcontracts/LibrariesLinkedManually/LibrariesLinkedManually.json"
    );

    const metadata = await import(
      "../../testcontracts/LibrariesLinkedManually/metadata.json"
    );
    const metadataBuffer = Buffer.from(JSON.stringify(metadata));

    const sourceBuffer = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "testcontracts",
        "LibrariesLinkedManually",
        "1_Storage.sol"
      )
    );

    const contractAddress = await deployFromAbiAndBytecode(
      chainFixture.localSigner,
      artifact.abi,
      artifact.bytecode
    );
    await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", contractAddress)
      .field("chain", chainFixture.chainId)
      .attach("files", metadataBuffer, "metadata.json")
      .attach("files", sourceBuffer);

    const res = await chai
      .request(serverFixture.server.app)
      .get(
        `/repository/contracts/full_match/${chainFixture.chainId}/${contractAddress}/library-map.json`
      );

    const expectedContent = {
      __$b8833469cd54bfd61b3a18436a18bad1f3$__:
        "0x7d53f102f4d4aa014db4e10d6deec2009b3cda6b",
    };
    chai.expect(res.body).to.deep.equal(expectedContent);

    const res1 = await chai
      .request(serverFixture.server.app)
      .get(`/files/any/${chainFixture.chainId}/${contractAddress}`);

    const fileToCheck = res1.body.files.find(
      (file: any) => file.name === "library-map.json"
    );
    chai
      .expect(fileToCheck.path)
      .to.equal(
        `contracts/full_match/${chainFixture.chainId}/${contractAddress}/library-map.json`
      );
    chai.expect(fileToCheck.content).to.be.a("string");
    chai.expect(JSON.parse(fileToCheck.content)).to.deep.equal(expectedContent);
  });

  it("should fetch creator-tx-hash.txt of specific address, and it should be available in /files/any", async function () {
    await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", chainFixture.defaultContractAddress)
      .field("chain", chainFixture.chainId)
      .field("creatorTxHash", chainFixture.defaultContractCreatorTx)
      .attach("files", chainFixture.defaultContractMetadata, "metadata.json")
      .attach("files", chainFixture.defaultContractSource);

    const resCreatorTxHash = await chai
      .request(serverFixture.server.app)
      .get(
        `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`
      );

    const expectedContent = chainFixture.defaultContractCreatorTx;
    chai.expect(resCreatorTxHash.status).to.equal(200);
    chai.expect(resCreatorTxHash.text).to.equal(expectedContent);

    const res1 = await chai
      .request(serverFixture.server.app)
      .get(
        `/files/any/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`
      );

    const fileToCheck = res1.body.files.find(
      (file: any) => file.name === "creator-tx-hash.txt"
    );
    chai
      .expect(fileToCheck.path)
      .to.equal(
        `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`
      );
    chai.expect(fileToCheck.content).to.equal(expectedContent);
  });

  it("should fetch constructor-args.txt of specific address, and it should be available in /files/any", async function () {
    const artifact = await import(
      "../../testcontracts/WithImmutables/artifact.json"
    );

    const metadata = await import(
      "../../testcontracts/WithImmutables/metadata.json"
    );
    const metadataBuffer = Buffer.from(JSON.stringify(metadata));
    const sourcePath = path.join(
      __dirname,
      "..",
      "..",
      "testcontracts",
      "WithImmutables",
      "sources",
      "WithImmutables.sol"
    );
    const sourceBuffer = fs.readFileSync(sourcePath);

    const { contractAddress, txHash } =
      await deployFromAbiAndBytecodeForCreatorTxHash(
        chainFixture.localSigner,
        artifact.abi,
        artifact.bytecode,
        [999]
      );
    await chai
      .request(serverFixture.server.app)
      .post("/")
      .field("address", contractAddress)
      .field("chain", chainFixture.chainId)
      .field("creatorTxHash", txHash)
      .attach("files", metadataBuffer, "metadata.json")
      .attach("files", sourceBuffer);

    const resConstructorArguments = await chai
      .request(serverFixture.server.app)
      .get(
        `/repository/contracts/full_match/${chainFixture.chainId}/${contractAddress}/constructor-args.txt`
      );

    const expectedContent =
      "0x00000000000000000000000000000000000000000000000000000000000003e7";
    chai.expect(resConstructorArguments.status).to.equal(200);
    chai.expect(resConstructorArguments.text).to.equal(expectedContent);

    const res1 = await chai
      .request(serverFixture.server.app)
      .get(`/files/any/${chainFixture.chainId}/${contractAddress}`);

    const fileToCheck = res1.body.files.find(
      (file: any) => file.name === "constructor-args.txt"
    );
    chai
      .expect(fileToCheck.path)
      .to.equal(
        `contracts/full_match/${chainFixture.chainId}/${contractAddress}/constructor-args.txt`
      );
    chai.expect(fileToCheck.content).to.equal(expectedContent);
  });

  describe(`Pagination in /files/contracts/{full|any|partial}/${chainFixture.chainId}`, async function () {
    const endpointMatchTypes = ["full", "any", "partial"];
    for (const endpointMatchType of endpointMatchTypes) {
      it(`should handle pagination in /files/contracts/${endpointMatchType}/${chainFixture.chainId}`, async function () {
        const contractAddresses: string[] = [];

        // Deploy 5 contracts
        for (let i = 0; i < 5; i++) {
          // Deploy partial matching contract if endpoint is partial or choose randomly if endpointMachtype is any. 'any' endpoint results should be consistent regardless.
          const shouldDeployPartial =
            endpointMatchType === "partial" ||
            (endpointMatchType === "any" && Math.random() > 0.5);

          const address = await deployAndVerifyContract(
            chai,
            chainFixture,
            serverFixture,
            shouldDeployPartial
          );
          contractAddresses.push(address);
        }

        // Test pagination
        const res0 = await chai
          .request(serverFixture.server.app)
          .get(
            `/files/contracts/${endpointMatchType}/${chainFixture.chainId}?page=1&limit=2`
          );
        chai.expect(res0.body.pagination).to.deep.equal({
          currentPage: 1,
          hasNextPage: true,
          hasPreviousPage: true,
          resultsCurrentPage: 2,
          resultsPerPage: 2,
          totalPages: 3,
          totalResults: 5,
        });
        const res1 = await chai
          .request(serverFixture.server.app)
          .get(
            `/files/contracts/${endpointMatchType}/${chainFixture.chainId}?limit=5`
          );
        chai.expect(res1.body.pagination).to.deep.equal({
          currentPage: 0,
          hasNextPage: false,
          hasPreviousPage: false,
          resultsCurrentPage: 5,
          resultsPerPage: 5,
          totalPages: 1,
          totalResults: 5,
        });

        // Test ascending order
        const resAsc = await chai
          .request(serverFixture.server.app)
          .get(
            `/files/contracts/${endpointMatchType}/${chainFixture.chainId}?order=asc`
          );
        chai
          .expect(resAsc.body.results)
          .to.deep.equal(
            contractAddresses,
            "Contract addresses are not in ascending order"
          );

        // Test descending order
        const resDesc = await chai
          .request(serverFixture.server.app)
          .get(
            `/files/contracts/${endpointMatchType}/${chainFixture.chainId}?order=desc`
          );
        chai
          .expect(resDesc.body.results)
          .to.deep.equal(
            contractAddresses.reverse(),
            "Contract addresses are not in reverse order"
          );
      });
    }
  });
});
