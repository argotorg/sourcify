import chai from "chai";
import config from "config";
import chaiHttp from "chai-http";
import {
  deployAndVerifyContract,
  deployFromAbiAndBytecode,
  deployFromAbiAndBytecodeForCreatorTxHash,
  waitSecs,
} from "../../../helpers/helpers";
import { LocalChainFixture } from "../../../helpers/LocalChainFixture";
import { ServerFixture } from "../../../helpers/ServerFixture";
import path from "path";
import fs from "fs";
import { RWStorageIdentifiers } from "../../../../src/server/services/storageServices/identifiers";

chai.use(chaiHttp);

describe("Verify repository endpoints", function () {
  const serverUrl = config.get("serverUrl");
  const chainFixture = new LocalChainFixture();
  const serverFixtureWithDatabase = new ServerFixture();
  serverFixtureWithDatabase.identifier = RWStorageIdentifiers.SourcifyDatabase;
  const serverFixtureWithRepositoryV1 = new ServerFixture({
    skipDatabaseReset: true,
    port: 5556, // use a different port
    read: RWStorageIdentifiers.RepositoryV1,
    writeOrErr: [RWStorageIdentifiers.RepositoryV1],
  });
  serverFixtureWithRepositoryV1.identifier = RWStorageIdentifiers.RepositoryV1;

  [serverFixtureWithDatabase, serverFixtureWithRepositoryV1].forEach(
    (serverFixture) => {
      it(`should fetch files of full match contract, using a non-checksummed address. Storage type: ${serverFixture.identifier}`, async function () {
        const agent = chai.request.agent(serverFixture.server.app);
        // Wait for the server to complete the previous contract verification
        await waitSecs(1);
        await agent
          .post("/")
          .field("address", chainFixture.defaultContractAddress)
          .field("chain", chainFixture.chainId)
          .attach(
            "files",
            chainFixture.defaultContractMetadata,
            "metadata.json",
          )
          .attach("files", chainFixture.defaultContractSource, "Storage.sol");
        const res0 = await agent.get(
          `/files/${
            chainFixture.chainId
          }/${chainFixture.defaultContractAddress.toLocaleLowerCase()}`,
        );
        chai.expect(res0.body).to.include.deep.members([
          {
            name: "Storage.sol",
            path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
            content: chainFixture.defaultContractSource.toString(),
          },
          {
            name: "metadata.json",
            path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
            content: chainFixture.defaultContractMetadata.toString(),
          },
          {
            name: "creator-tx-hash.txt",
            path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
            content: chainFixture.defaultContractCreatorTx,
          },
        ]);
        const res1 = await agent.get(
          `/files/tree/any/${
            chainFixture.chainId
          }/${chainFixture.defaultContractAddress.toLocaleLowerCase()}`,
        );
        chai.expect(res1.body.status).to.equal("full");
        chai
          .expect(res1.body.files)
          .to.have.members([
            `${serverUrl}/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
            `${serverUrl}/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
            `${serverUrl}/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
          ]);
        const res2 = await agent.get(
          `/files/any/${
            chainFixture.chainId
          }/${chainFixture.defaultContractAddress.toLocaleLowerCase()}`,
        );
        chai.expect(res2.body.status).to.equal("full");
        chai.expect(res2.body.files).to.include.deep.members([
          {
            name: "Storage.sol",
            path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
            content: chainFixture.defaultContractSource.toString(),
          },
          {
            name: "metadata.json",
            path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
            content: chainFixture.defaultContractMetadata.toString(),
          },
          {
            name: "creator-tx-hash.txt",
            path: `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
            content: chainFixture.defaultContractCreatorTx,
          },
        ]);
        const res3 = await agent.get(
          `/files/tree/${
            chainFixture.chainId
          }/${chainFixture.defaultContractAddress.toLocaleLowerCase()}`,
        );
        chai
          .expect(res3.body)
          .to.have.members([
            `${serverUrl}/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
            `${serverUrl}/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
            `${serverUrl}/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
          ]);
        const res4 = await agent.get(
          `/files/contracts/${chainFixture.chainId}`,
        );
        chai.expect(res4.body).to.deep.equal({
          full: [chainFixture.defaultContractAddress],
          partial: [],
        });

        const res5 = await agent.get(
          `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
        );
        chai
          .expect(res5.text)
          .to.equal(chainFixture.defaultContractSource.toString());

        const res6 = await agent.get(
          `/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/project:/contracts/Storage.sol`,
        );
        chai.expect(res6.status).to.equal(404);

        const res7 = await agent.get(
          `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
        );
        chai
          .expect(res7.body)
          .to.deep.equal(
            JSON.parse(chainFixture.defaultContractMetadata.toString()),
          );

        const res8 = await agent.get(
          `/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
        );
        chai.expect(res8.status).to.equal(404);

        const res9 = await agent.get(
          `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
        );

        chai.expect(res9.text).to.equal(chainFixture.defaultContractCreatorTx);

        const res10 = await agent.get(
          `/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/constructor-args.txt`,
        );
        chai.expect(res10.status).to.equal(404);
      });

      it(`should fetch files of partial match contract. Storage type: ${serverFixture.identifier}`, async function () {
        const agent = chai.request.agent(serverFixture.server.app);
        // Wait for the server to complete the previous contract verification
        await waitSecs(1);
        await agent
          .post("/")
          .field("address", chainFixture.defaultContractAddress)
          .field("chain", chainFixture.chainId)
          .attach(
            "files",
            chainFixture.defaultContractModifiedMetadata,
            "metadata.json",
          )
          .attach(
            "files",
            chainFixture.defaultContractModifiedSource,
            "StorageModified.sol",
          );
        const res0 = await agent.get(
          `/files/${
            chainFixture.chainId
          }/${chainFixture.defaultContractAddress.toLocaleLowerCase()}`,
        );
        chai.expect(res0.body).to.deep.equal({
          error: "Files have not been found!",
          message: "Files have not been found!",
        });
        const res1 = await agent.get(
          `/files/tree/any/${
            chainFixture.chainId
          }/${chainFixture.defaultContractAddress.toLocaleLowerCase()}`,
        );
        chai.expect(res1.body.status).to.equal("partial");
        chai
          .expect(res1.body.files)
          .to.have.members([
            `${serverUrl}/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/contracts/StorageModified.sol`,
            `${serverUrl}/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
            `${serverUrl}/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
          ]);
        const res2 = await agent.get(
          `/files/any/${
            chainFixture.chainId
          }/${chainFixture.defaultContractAddress.toLocaleLowerCase()}`,
        );
        chai.expect(res2.body.status).to.equal("partial");
        chai.expect(res2.body.files).to.include.deep.members([
          {
            name: "StorageModified.sol",
            path: `contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/contracts/StorageModified.sol`,
            content: chainFixture.defaultContractModifiedSource.toString(),
          },
          {
            name: "metadata.json",
            path: `contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
            content: chainFixture.defaultContractModifiedMetadata.toString(),
          },
          {
            name: "creator-tx-hash.txt",
            path: `contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
            content: chainFixture.defaultContractCreatorTx,
          },
        ]);
        const res3 = await agent.get(
          `/files/tree/${
            chainFixture.chainId
          }/${chainFixture.defaultContractAddress.toLocaleLowerCase()}`,
        );
        chai.expect(res3.body).to.deep.equal({
          error: "Files have not been found!",
          message: "Files have not been found!",
        });
        const res4 = await agent.get(
          `/files/contracts/${chainFixture.chainId}`,
        );
        chai.expect(res4.body).to.deep.equal({
          full: [],
          partial: [chainFixture.defaultContractAddress],
        });

        // Check the sources/contracts/StorageModified.sol
        const res5 = await agent.get(
          `/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/contracts/StorageModified.sol`,
        );
        chai
          .expect(res5.text)
          .to.equal(chainFixture.defaultContractModifiedSource.toString());

        const res6 = await agent.get(
          `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/sources/contracts/StorageModified.sol`,
        );
        chai.expect(res6.status).to.equal(404);

        // Check the metadata.json
        const res7 = await agent.get(
          `/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
        );
        chai
          .expect(res7.body)
          .to.deep.equal(
            JSON.parse(chainFixture.defaultContractModifiedMetadata.toString()),
          );

        const res8 = await agent.get(
          `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
        );
        chai.expect(res8.status).to.equal(404);

        // Check the creator tx hash
        const res9 = await agent.get(
          `/repository/contracts/partial_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
        );
        chai.expect(res9.text).to.equal(chainFixture.defaultContractCreatorTx);

        const res10 = await agent.get(
          `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/constructor-args.txt`,
        );
        chai.expect(res10.status).to.equal(404);
      });

      it(`should fetch a .sol file of specific address. Storage type: ${serverFixture.identifier}`, async function () {
        const agent = chai.request.agent(serverFixture.server.app);
        // Wait for the server to complete the previous contract verification
        await waitSecs(1);
        await agent
          .post("/")
          .field("address", chainFixture.defaultContractAddress)
          .field("chain", chainFixture.chainId)
          .attach(
            "files",
            chainFixture.defaultContractMetadata,
            "metadata.json",
          )
          .attach("files", chainFixture.defaultContractSource, "Storage.sol");

        const res = await agent.get(
          `/files/tree/${
            chainFixture.chainId
          }/${chainFixture.defaultContractAddress.toLocaleLowerCase()}`,
        );
        const url = res.body.find((url: string) => url.includes("Storage.sol"));
        const res1 = await agent.get(
          "/repository/" + url.replace(`${serverUrl}/repository/`, ""),
        );
        chai
          .expect(res1.text)
          .to.equal(chainFixture.defaultContractSource.toString());
      });

      it(`should fetch metadata.json of specific address. Storage type: ${serverFixture.identifier}`, async function () {
        const agent = chai.request.agent(serverFixture.server.app);
        // Wait for the server to complete the previous contract verification
        await waitSecs(1);
        await agent
          .post("/")
          .field("address", chainFixture.defaultContractAddress)
          .field("chain", chainFixture.chainId)
          .attach(
            "files",
            chainFixture.defaultContractMetadata,
            "metadata.json",
          )
          .attach("files", chainFixture.defaultContractSource, "Storage.sol");
        const res = await chai
          .request(serverFixture.server.app)
          .get(
            `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/metadata.json`,
          );
        chai
          .expect(res.text)
          .to.equal(chainFixture.defaultContractMetadata.toString());

        const res1 = await chai
          .request(serverFixture.server.app)
          .get(
            `/files/any/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
          );

        const fileToCheck = res1.body.files.find(
          (file: any) => file.name === "metadata.json",
        );
        chai.expect(fileToCheck.content).to.be.a("string");
        chai
          .expect(fileToCheck.content)
          .to.equal(chainFixture.defaultContractMetadata.toString());
      });

      it(`should fetch immutable-references.json of specific address, and it should be available in /files/any. Storage type: ${serverFixture.identifier}`, async function () {
        const artifact = (
          await import("../../../testcontracts/WithImmutables/artifact.json")
        ).default;

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

        const contractAddress = await deployFromAbiAndBytecode(
          chainFixture.localSigner,
          artifact.abi,
          artifact.bytecode,
          [999],
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
            `/repository/contracts/full_match/${chainFixture.chainId}/${contractAddress}/immutable-references.json`,
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
          (file: any) => file.name === "immutable-references.json",
        );
        chai
          .expect(fileToCheck.path)
          .to.equal(
            `contracts/full_match/${chainFixture.chainId}/${contractAddress}/immutable-references.json`,
          );
        chai.expect(fileToCheck.content).to.be.a("string");
        chai
          .expect(JSON.parse(fileToCheck.content))
          .to.deep.equal(expectedContent);
      });

      it(`should fetch library-map.json of specific address, and it should be available in /files/any. Storage type: ${serverFixture.identifier}`, async function () {
        const artifact = (
          await import("../../../testcontracts/LibrariesLinkedManually/LibrariesLinkedManually.json")
        ).default;

        const metadata = (
          await import("../../../testcontracts/LibrariesLinkedManually/metadata.json")
        ).default;
        const metadataBuffer = Buffer.from(JSON.stringify(metadata));

        const sourceBuffer = fs.readFileSync(
          path.join(
            __dirname,
            "..",
            "..",
            "..",
            "testcontracts",
            "LibrariesLinkedManually",
            "1_Storage.sol",
          ),
        );

        const contractAddress = await deployFromAbiAndBytecode(
          chainFixture.localSigner,
          artifact.abi,
          artifact.bytecode,
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
            `/repository/contracts/full_match/${chainFixture.chainId}/${contractAddress}/library-map.json`,
          );

        const expectedContent = {
          __$b8833469cd54bfd61b3a18436a18bad1f3$__:
            serverFixture.identifier === RWStorageIdentifiers.SourcifyDatabase
              ? "0x7d53f102f4d4aa014db4e10d6deec2009b3cda6b"
              : "7d53f102f4d4aa014db4e10d6deec2009b3cda6b",
        };
        chai.expect(res.body).to.deep.equal(expectedContent);

        const res1 = await chai
          .request(serverFixture.server.app)
          .get(`/files/any/${chainFixture.chainId}/${contractAddress}`);

        const fileToCheck = res1.body.files.find(
          (file: any) => file.name === "library-map.json",
        );
        chai
          .expect(fileToCheck.path)
          .to.equal(
            `contracts/full_match/${chainFixture.chainId}/${contractAddress}/library-map.json`,
          );
        chai.expect(fileToCheck.content).to.be.a("string");
        chai
          .expect(JSON.parse(fileToCheck.content))
          .to.deep.equal(expectedContent);
      });

      it(`should fetch creator-tx-hash.txt of specific address, and it should be available in /files/any. Storage type: ${serverFixture.identifier}`, async function () {
        await chai
          .request(serverFixture.server.app)
          .post("/")
          .field("address", chainFixture.defaultContractAddress)
          .field("chain", chainFixture.chainId)
          .field("creatorTxHash", chainFixture.defaultContractCreatorTx)
          .attach(
            "files",
            chainFixture.defaultContractMetadata,
            "metadata.json",
          )
          .attach("files", chainFixture.defaultContractSource);

        const resCreatorTxHash = await chai
          .request(serverFixture.server.app)
          .get(
            `/repository/contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
          );

        const expectedContent = chainFixture.defaultContractCreatorTx;
        chai.expect(resCreatorTxHash.status).to.equal(200);
        chai.expect(resCreatorTxHash.text).to.equal(expectedContent);

        const res1 = await chai
          .request(serverFixture.server.app)
          .get(
            `/files/any/${chainFixture.chainId}/${chainFixture.defaultContractAddress}`,
          );

        const fileToCheck = res1.body.files.find(
          (file: any) => file.name === "creator-tx-hash.txt",
        );
        chai
          .expect(fileToCheck.path)
          .to.equal(
            `contracts/full_match/${chainFixture.chainId}/${chainFixture.defaultContractAddress}/creator-tx-hash.txt`,
          );
        chai.expect(fileToCheck.content).to.equal(expectedContent);
      });

      it(`should fetch constructor-args.txt of specific address, and it should be available in /files/any. Storage type: ${serverFixture.identifier}`, async function () {
        const artifact = (
          await import("../../../testcontracts/WithImmutables/artifact.json")
        ).default;

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

        const { contractAddress, txHash } =
          await deployFromAbiAndBytecodeForCreatorTxHash(
            chainFixture.localSigner,
            artifact.abi,
            artifact.bytecode,
            [999],
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
            `/repository/contracts/full_match/${chainFixture.chainId}/${contractAddress}/constructor-args.txt`,
          );

        const expectedContent =
          "0x00000000000000000000000000000000000000000000000000000000000003e7";
        chai.expect(resConstructorArguments.status).to.equal(200);
        chai.expect(resConstructorArguments.text).to.equal(expectedContent);

        const res1 = await chai
          .request(serverFixture.server.app)
          .get(`/files/any/${chainFixture.chainId}/${contractAddress}`);

        const fileToCheck = res1.body.files.find(
          (file: any) => file.name === "constructor-args.txt",
        );
        chai
          .expect(fileToCheck.path)
          .to.equal(
            `contracts/full_match/${chainFixture.chainId}/${contractAddress}/constructor-args.txt`,
          );
        chai.expect(fileToCheck.content).to.equal(expectedContent);
      });
    },
  );

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
            chainFixture,
            serverFixtureWithDatabase,
            shouldDeployPartial,
          );
          contractAddresses.push(address);
        }

        // Test pagination
        const res0 = await chai
          .request(serverFixtureWithDatabase.server.app)
          .get(
            `/files/contracts/${endpointMatchType}/${chainFixture.chainId}?page=1&limit=2`,
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
          .request(serverFixtureWithDatabase.server.app)
          .get(
            `/files/contracts/${endpointMatchType}/${chainFixture.chainId}?limit=5`,
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
          .request(serverFixtureWithDatabase.server.app)
          .get(
            `/files/contracts/${endpointMatchType}/${chainFixture.chainId}?order=asc`,
          );
        chai
          .expect(resAsc.body.results)
          .to.deep.equal(
            contractAddresses,
            "Contract addresses are not in ascending order",
          );

        // Test descending order
        const resDesc = await chai
          .request(serverFixtureWithDatabase.server.app)
          .get(
            `/files/contracts/${endpointMatchType}/${chainFixture.chainId}?order=desc`,
          );
        chai
          .expect(resDesc.body.results)
          .to.deep.equal(
            contractAddresses.reverse(),
            "Contract addresses are not in reverse order",
          );
      });
    }
  });
});
