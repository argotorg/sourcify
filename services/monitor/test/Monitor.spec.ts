import { expect } from "chai";
import type { SinonSandbox } from "sinon";
import sinon from "sinon";
import Monitor, { authenticateRpcs } from "../src/Monitor";
import logger from "../src/logger";
import type { JsonRpcSigner } from "ethers";
import { JsonRpcProvider, Network } from "ethers";
import {
  deployFromAbiAndBytecode,
  nockInterceptorForVerification,
} from "./helpers";
import { logger as testLogger } from "./testLogger";
import {
  startHardhatNetwork,
  stopHardhatNetwork,
} from "@ethereum-sourcify/test-helpers";
import type { ChildProcess } from "child_process";
import storageContractArtifact from "./sources/Storage/1_Storage.json";
import storageContractMetadata from "./sources/Storage/1_Storage.metadata.json";
import nock from "nock";
import fs from "fs";
import path from "path";
import { AuxdataStyle, decode } from "@ethereum-sourcify/bytecode-utils";
import type { RpcObject } from "../src/types";
import type { FetchRequestRPC } from "@ethereum-sourcify/lib-sourcify";

const HARDHAT_PORT = 8546;
// Configured in hardhat.config.js
const HARDHAT_BLOCK_TIME_IN_SEC = 3;
const MOCK_SOURCIFY_SERVER = "http://mocksourcifyserver.dev/server/";
const MOCK_SIMILARITY_SERVER = "http://mocksimilarity.dev/server/";
const MOCK_IPFS_ORIGIN = "http://mockipfs.dev";
const MOCK_IPFS_GATEWAY = `${MOCK_IPFS_ORIGIN}/ipfs/`;
const IPFS_URL_PREFIX = "dweb:/ipfs/";
const localChain = {
  chainId: 1337,
  rpc: [`http://localhost:${HARDHAT_PORT}`],
  name: "Localhost Hardhat Network",
};

/**
 * Mocks the IPFS gateway with nock so that the test does not depend on a live
 * gateway. Serves the metadata of the Storage contract and its source file.
 */
function nockIpfsGatewayForStorageContract() {
  const cborData = decode(
    storageContractArtifact.bytecode,
    AuxdataStyle.SOLIDITY,
  );
  const metadataCid = cborData.ipfs;
  expect(metadataCid, "No IPFS CID in the test contract bytecode").to.be.a(
    "string",
  );

  const sourceUrls: string[] = Object.values(storageContractMetadata.sources)[0]
    .urls;
  const sourceIpfsUrl = sourceUrls.find((url) =>
    url.startsWith(IPFS_URL_PREFIX),
  );
  expect(sourceIpfsUrl, "No IPFS url in the test metadata").to.be.a("string");
  const sourceCid = sourceIpfsUrl!.slice(IPFS_URL_PREFIX.length);
  // The compiled source has no trailing newline. Remove it to match the
  // keccak256 in the metadata.
  const sourceContent = fs
    .readFileSync(
      path.join(__dirname, "sources", "Storage", "1_Storage.sol"),
      "utf8",
    )
    .replace(/\n$/, "");

  return nock(MOCK_IPFS_ORIGIN)
    .get(`/ipfs/${metadataCid}`)
    .reply(200, JSON.stringify(storageContractMetadata))
    .get(`/ipfs/${sourceCid}`)
    .reply(200, sourceContent);
}

describe("Monitor", function () {
  let sandbox: SinonSandbox;
  let hardhatNodeProcess: ChildProcess;
  let signer: JsonRpcSigner;
  let account: string;
  let monitor: Monitor;

  beforeEach(async function () {
    sandbox = sinon.createSandbox();

    hardhatNodeProcess = await startHardhatNetwork(HARDHAT_PORT, {
      chainId: 1337,
      miningInterval: HARDHAT_BLOCK_TIME_IN_SEC * 1000,
    });
    testLogger.info("Started hardhat node at port " + HARDHAT_PORT);
    const ethersNetwork = new Network(localChain.rpc[0], localChain.chainId);
    signer = await new JsonRpcProvider(
      `http://localhost:${HARDHAT_PORT}`,
      ethersNetwork,
      { staticNetwork: ethersNetwork },
    ).getSigner();
    signer.provider.on("block", (blockNumber) => {
      testLogger.info("New block mined: " + blockNumber);
    });
    account = await signer.getAddress();
    testLogger.info("Initialized provider with signer account " + account);
  });

  afterEach(async function () {
    await stopHardhatNetwork(hardhatNodeProcess);
    if (monitor) monitor.stop();
    sandbox.restore();
    nock.cleanAll();
  });

  describe("authenticateRpcs", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = process.env;
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
      sinon.restore();
    });

    it("should return string RPC unchanged", () => {
      const rpc = "https://example.com/rpc";
      const result = authenticateRpcs({ chainId: 1, rpc: [rpc], name: "Test" });
      expect(result).to.deep.equal([{ rpc }]);
    });

    it("should replace API key in URL for ApiKey type", () => {
      process.env.TEST_API_KEY = "testkey123";
      const rpc: RpcObject = {
        type: "ApiKey",
        url: "https://example.com/rpc/{API_KEY}",
        apiKeyEnvName: "TEST_API_KEY",
      };
      const result = authenticateRpcs({ chainId: 1, rpc: [rpc], name: "Test" });
      expect(result).to.deep.equal([
        { rpc: "https://example.com/rpc/testkey123" },
      ]);
    });

    it("should replace subdomain in URL for ApiKey type", () => {
      process.env.TEST_API_KEY = "testkey123";
      process.env.TEST_SUBDOMAIN = "test-subdomain";
      const rpc: RpcObject = {
        type: "ApiKey",
        url: "https://{SUBDOMAIN}.example.com/rpc/{API_KEY}",
        apiKeyEnvName: "TEST_API_KEY",
        subDomainEnvName: "TEST_SUBDOMAIN",
      };
      const result = authenticateRpcs({ chainId: 1, rpc: [rpc], name: "Test" });
      expect(result).to.deep.equal([
        { rpc: "https://test-subdomain.example.com/rpc/testkey123" },
      ]);
    });

    it("should throw error if API key is not found in environment variables", () => {
      const rpc: RpcObject = {
        type: "ApiKey",
        url: "https://example.com/rpc/{API_KEY}",
        apiKeyEnvName: "NONEXISTENT_API_KEY",
      };
      expect(() =>
        authenticateRpcs({ chainId: 1, rpc: [rpc], name: "Test" }),
      ).to.throw(
        "API key NONEXISTENT_API_KEY not found in environment variables",
      );
    });

    it("should create FetchRequest for ethpandaops.io URLs", () => {
      const clientId = "client123";
      const clientSecret = "secret456";
      process.env.CF_ACCESS_CLIENT_ID = clientId;
      process.env.CF_ACCESS_CLIENT_SECRET = clientSecret;
      const rpc = ["https://rpc.ethpandaops.io/test"];
      const result = authenticateRpcs({ chainId: 1, rpc: rpc, name: "Test" });

      const fetchRequest = result[0].rpc as FetchRequestRPC;
      expect(fetchRequest.url).to.equal("https://rpc.ethpandaops.io/test");
      expect(fetchRequest.headers).to.be.an("array");
      expect(fetchRequest.headers).to.have.lengthOf(2);
      expect(fetchRequest.headers).to.deep.include({
        headerName: "CF-Access-Client-Id",
        headerValue: clientId,
      });
      expect(fetchRequest.headers).to.deep.include({
        headerName: "CF-Access-Client-Secret",
        headerValue: clientSecret,
      });
    });

    it("should throw error for invalid RPC object", () => {
      const rpc = { invalidProp: "test" };
      expect(() =>
        // @ts-ignore
        authenticateRpcs({ chainId: 1, rpc: [rpc], name: "Test" }),
      ).to.throw('Invalid rpc object: {"invalidProp":"test"}');
    });
  });

  it("should use default config when no config is provided", () => {
    const loggerSpy = sinon.spy(logger, "warn");
    const _monitor = new Monitor([localChain]);
    expect(
      loggerSpy.calledWith(
        sinon.match(/No config provided, using default config/),
      ),
    ).to.be.true;
  });

  it("should throw an error if no chains are provided", () => {
    expect(() => new Monitor([])).to.throw("No chains to monitor");
  });

  it("should throw an error if there are chainConfigs for chains not being monitored", () => {
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(
      () =>
        new Monitor([localChain], {
          chainConfigs: {
            2: {},
          },
        }),
    ).to.throw(
      "Chain configs found for chains that are not being monitored: 2",
    );
    process.env.NODE_ENV = nodeEnv;
  });

  it("should enable factory monitoring when MONITOR_FACTORIES env var is set to true", () => {
    const monitorFactories = process.env.MONITOR_FACTORIES;
    process.env.MONITOR_FACTORIES = "true";
    const monitor = new Monitor([localChain]);

    expect(monitor["config"].monitorFactories).to.be.true;
    monitor["chainMonitors"].forEach((chainMonitor) => {
      expect(chainMonitor["monitorFactories"]).to.be.true;
    });

    if (monitorFactories !== undefined) {
      process.env.MONITOR_FACTORIES = monitorFactories;
    } else {
      delete process.env.MONITOR_FACTORIES;
    }
  });

  it("should successfully catch a deployed contract, assemble, and send to Sourcify", async () => {
    const ipfsScope = nockIpfsGatewayForStorageContract();
    monitor = new Monitor([localChain], {
      sourcifyServerURLs: [MOCK_SOURCIFY_SERVER],
      decentralizedStorages: {
        ipfs: {
          enabled: true,
          gateways: [MOCK_IPFS_GATEWAY],
        },
      },
      chainConfigs: {
        [localChain.chainId]: {
          startBlock: 0,
          blockInterval: HARDHAT_BLOCK_TIME_IN_SEC * 1000,
        },
      },
    });

    const contractAddress = await deployFromAbiAndBytecode(
      signer,
      storageContractArtifact.abi,
      storageContractArtifact.bytecode,
      [],
    );

    // Set up a nock interceptor to intercept the request to MOCK_SOURCIFY_SERVER url.
    const nockInterceptor = nockInterceptorForVerification(
      MOCK_SOURCIFY_SERVER,
      localChain.chainId,
      contractAddress,
    );

    // start monitor after contract is deployed to avoid sending request before setting up interceptor
    // Need to know the contract address to set up the interceptor
    await monitor.start();
    await new Promise<void>((resolve) => {
      nockInterceptor.on("replied", () => {
        expect(
          nockInterceptor.isDone(),
          `Server ${MOCK_SOURCIFY_SERVER} not called`,
        ).to.be.true;
        expect(ipfsScope.isDone(), "IPFS gateway not called for all files").to
          .be.true;
        resolve();
      });
    });
  });

  it("should trigger similarity verification when contract assembly fails", async () => {
    monitor = new Monitor([localChain], {
      sourcifyServerURLs: [MOCK_SIMILARITY_SERVER],
      decentralizedStorages: {
        ipfs: {
          enabled: false,
          gateways: [],
        },
      },
      chainConfigs: {
        [localChain.chainId]: {
          startBlock: 0,
          blockInterval: HARDHAT_BLOCK_TIME_IN_SEC * 1000,
        },
      },
      similarityVerification: {
        requestDelay: 2000, // Override to 2 seconds for faster tests
      },
    });

    const contractAddress = await deployFromAbiAndBytecode(
      signer,
      storageContractArtifact.abi,
      storageContractArtifact.bytecode,
      [],
    );

    const similarityScope = nock("http://mocksimilarity.dev")
      .post(
        `/server/v2/verify/similarity/${localChain.chainId}/${contractAddress}`,
        (body) => {
          expect(body).to.have.property("creationTransactionHash");
          return true;
        },
      )
      .reply(200, { status: "ok" });

    await monitor.start();

    await new Promise<void>((resolve, reject) => {
      similarityScope.on("replied", () => resolve());
      setTimeout(
        () => reject(new Error("Similarity verification not called")),
        10000,
      );
    });

    expect(similarityScope.isDone()).to.be.true;
  });
  // Add more test cases as needed
});
