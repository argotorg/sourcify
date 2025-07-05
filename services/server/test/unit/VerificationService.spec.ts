import { VerificationService } from "../../src/server/services/VerificationService";
import nock from "nock";
import fs from "fs";
import path from "path";
import { expect } from "chai";
import { findSolcPlatform } from "@ethereum-sourcify/compilers";
import config from "config";
import rimraf from "rimraf";
import { StorageService } from "../../src/server/services/StorageService";
import { RWStorageIdentifiers } from "../../src/server/services/storageServices/identifiers";

describe("VerificationService", function () {
  beforeEach(function () {
    // Clear any previously nocked interceptors
    nock.cleanAll();
  });

  afterEach(function () {
    // Ensure that all nock interceptors have been used
    nock.isDone();
  });

  it("should initialize compilers", async function () {
    rimraf.sync(config.get("solcRepo"));
    rimraf.sync(config.get("solJsonRepo"));

    const platform = findSolcPlatform() || "bin";
    const HOST_SOLC_REPO = "https://binaries.soliditylang.org";

    // Mock the list of solc versions to not download every single
    let releases: Record<string, string>;
    if (platform === "bin") {
      releases = {
        "0.8.26": "soljson-v0.8.26+commit.8a97fa7a.js",
        "0.6.12": "soljson-v0.6.12+commit.27d51765.js",
      };
      nock(HOST_SOLC_REPO, { allowUnmocked: true })
        .get("/bin/list.json")
        .reply(200, {
          releases,
        });
    } else if (platform === "macosx-amd64") {
      releases = {
        "0.8.26": "solc-macosx-amd64-v0.8.26+commit.8a97fa7a",
        "0.6.12": "solc-macosx-amd64-v0.6.12+commit.27d51765",
        "0.4.10": "solc-macosx-amd64-v0.4.10+commit.f0d539ae",
      };
      nock(HOST_SOLC_REPO, { allowUnmocked: true })
        .get("/macosx-amd64/list.json")
        .reply(200, {
          releases,
        });
    } else {
      releases = {
        "0.8.26": "solc-linux-amd64-v0.8.26+commit.8a97fa7a",
        "0.6.12": "solc-linux-amd64-v0.6.12+commit.27d51765",
        "0.4.10": "solc-linux-amd64-v0.4.10+commit.9e8cc01b",
      };
      nock(HOST_SOLC_REPO, { allowUnmocked: true })
        .get("/linux-amd64/list.json")
        .reply(200, {
          releases,
        });
    }

    const verificationService = new VerificationService(
      {
        initCompilers: true,
        sourcifyChainMap: {},
        solcRepoPath: config.get("solcRepo"),
        solJsonRepoPath: config.get("solJsonRepo"),
        vyperRepoPath: config.get("vyperRepo"),
      },
      new StorageService({
        enabledServices: {
          read: RWStorageIdentifiers.RepositoryV1,
          writeOrWarn: [],
          writeOrErr: [],
        },
        serverUrl: "http://localhost",
        repositoryV1ServiceOptions: {
          repositoryPath: config.get("repositoryV1.path"),
        },
      }),
    );

    // Call the init method to trigger the download
    await verificationService.init();

    // Check if the files exist in the expected directory
    const downloadDir =
      platform === "bin"
        ? config.get<string>("solJsonRepo")
        : config.get<string>("solcRepo");

    Object.values(releases).forEach((release) => {
      expect(fs.existsSync(path.join(downloadDir, release))).to.be.true;
    });
  });
});
