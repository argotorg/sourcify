import path from "path";
import fs from "fs";
import {
  deployFromAbiAndBytecodeForCreatorTxHash,
  DeploymentInfo,
  readFilesFromDirectory,
} from "./helpers";
import { JsonRpcProvider, JsonRpcSigner, Network } from "ethers";
import { LOCAL_CHAINS } from "../../src/sourcify-chains";
import nock from "nock";
import storageContractArtifact from "../testcontracts/Storage/Storage.json";
import storageContractMetadata from "../testcontracts/Storage/metadata.json";
import storageContractMetadataModified from "../testcontracts/Storage/metadataModified.json";
import storageJsonInput from "../testcontracts/Storage/StorageJsonInput.json";
import { ChildProcess, spawn } from "child_process";
import treeKill from "tree-kill";
import { SolidityMetadataContract } from "@ethereum-sourcify/lib-sourcify";
import type { Metadata } from "@ethereum-sourcify/lib-sourcify";

const storageContractSourcePath = path.join(
  __dirname,
  "..",
  "testcontracts",
  "Storage",
  "Storage.sol",
);
const storageContractSource = fs.readFileSync(storageContractSourcePath);

const storageModifiedContractSourcePath = path.join(
  __dirname,
  "..",
  "testcontracts",
  "Storage",
  "StorageModified.sol",
);
const storageModifiedContractSource = fs.readFileSync(
  storageModifiedContractSourcePath,
);

const HARDHAT_PORT = 8545;
const DEFAULT_CHAIN_ID = "31337";

export type LocalChainFixtureOptions = {
  chainId?: string;
  port?: number;
};

export class LocalChainFixture {
  defaultContractSource = storageContractSource;
  defaultContractModifiedSource = storageModifiedContractSource;
  defaultContractMetadata = Buffer.from(
    JSON.stringify(storageContractMetadata),
  );
  defaultContractMetadataObject = storageContractMetadata as Metadata;
  defaultContractModifiedMetadata = Buffer.from(
    JSON.stringify(storageContractMetadataModified),
  );
  defaultContractMetadataWithModifiedIpfsHash =
    getMetadataWithModifiedIpfsHash();
  defaultContractArtifact = storageContractArtifact;
  defaultContractJsonInput = storageJsonInput;

  private _chainId: string;
  private _port: number;
  private _localSigner?: JsonRpcSigner;
  private _defaultContractAddress?: string;
  private _defaultContractCreatorTx?: string;
  private _defaultContractBlockNumber?: number;
  private _defaultContractTxIndex?: number;

  private hardhatNodeProcess?: ChildProcess;

  // Getters for type safety
  // Can be safely accessed in "it" blocks
  get chainId(): string {
    if (!this._chainId) throw new Error("chainId not initialized!");
    return this._chainId;
  }
  get localSigner(): JsonRpcSigner {
    if (!this._localSigner) throw new Error("localSigner not initialized!");
    return this._localSigner;
  }
  get defaultContractAddress(): string {
    if (!this._defaultContractAddress)
      throw new Error("defaultContractAddress not initialized!");
    return this._defaultContractAddress;
  }
  get defaultContractCreatorTx(): string {
    if (!this._defaultContractCreatorTx)
      throw new Error("defaultContractCreatorTx not initialized!");
    return this._defaultContractCreatorTx;
  }
  get defaultContractBlockNumber(): number {
    if (this._defaultContractBlockNumber === undefined)
      throw new Error("defaultContractBlockNumber not initialized!");
    return this._defaultContractBlockNumber;
  }
  get defaultContractTxIndex(): number {
    if (this._defaultContractTxIndex === undefined)
      throw new Error("defaultContractTxIndex not initialized!");
    return this._defaultContractTxIndex;
  }

  get defaultContractDeploymentInfo(): DeploymentInfo {
    return {
      contractAddress: this.defaultContractAddress,
      txHash: this.defaultContractCreatorTx,
      blockNumber: this.defaultContractBlockNumber,
      txIndex: this.defaultContractTxIndex,
    };
  }

  /**
   * Creates a local test chain and deploys the test contract.
   * Expected to be called in a "describe" block.
   */
  constructor(options: LocalChainFixtureOptions = {}) {
    this._chainId = options.chainId ?? DEFAULT_CHAIN_ID;
    this._port = options.port ?? HARDHAT_PORT;

    before(async () => {
      // Init IPFS mock with all the necessary pinned files
      const mockContent = await readFilesFromDirectory(
        path.join(__dirname, "..", "mocks", "ipfs"),
      );
      for (const ipfsKey of Object.keys(mockContent)) {
        nock(SolidityMetadataContract.getGlobalIpfsGateway().url || "")
          .persist()
          .get("/" + ipfsKey)
          .reply(function () {
            return [200, mockContent[ipfsKey]];
          });
      }

      this.hardhatNodeProcess = await startHardhatNetwork(this._port);

      const sourcifyChainHardhat = LOCAL_CHAINS[1];
      const ethersNetwork = new Network(
        sourcifyChainHardhat.rpc[0] as string,
        sourcifyChainHardhat.chainId,
      );
      this._localSigner = await new JsonRpcProvider(
        `http://localhost:${this._port}`,
        ethersNetwork,
        { staticNetwork: ethersNetwork },
      ).getSigner();
      console.log("Initialized Provider");

      // Deploy the test contract
      const { contractAddress, txHash, blockNumber, txIndex } =
        await deployFromAbiAndBytecodeForCreatorTxHash(
          this._localSigner,
          storageContractArtifact.abi,
          storageContractArtifact.bytecode,
        );
      this._defaultContractAddress = contractAddress;
      this._defaultContractCreatorTx = txHash;
      this._defaultContractBlockNumber = blockNumber;
      this._defaultContractTxIndex = txIndex;
    });

    after(async () => {
      if (this.hardhatNodeProcess) {
        await stopHardhatNetwork(this.hardhatNodeProcess);
      }
      nock.cleanAll();
    });
  }
}

function startHardhatNetwork(port: number) {
  return new Promise<ChildProcess>((resolve) => {
    const hardhatNodeProcess = spawn("npx", [
      "hardhat",
      "node",
      "--port",
      port.toString(),
    ]);

    hardhatNodeProcess.stderr.on("data", (data: Buffer) => {
      console.error(`Hardhat Network Error: ${data.toString()}`);
    });

    hardhatNodeProcess.stdout.on("data", (data: Buffer) => {
      console.log(data.toString());
      if (
        data
          .toString()
          .includes("Started HTTP and WebSocket JSON-RPC server at")
      ) {
        resolve(hardhatNodeProcess);
      }
    });
  });
}

function stopHardhatNetwork(hardhatNodeProcess: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    treeKill(hardhatNodeProcess.pid!, "SIGTERM", (err) => {
      if (err) {
        console.error(`Failed to kill process tree: ${err}`);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Changes the IPFS hash inside the metadata file to make the source unfetchable
function getMetadataWithModifiedIpfsHash(): Metadata {
  const ipfsAddress =
    storageContractMetadata.sources["project:/contracts/Storage.sol"].urls[1];
  // change the last char in ipfs hash of the source file
  const lastChar = ipfsAddress.charAt(ipfsAddress.length - 1);
  const modifiedLastChar = lastChar === "a" ? "b" : "a";
  const modifiedIpfsAddress =
    ipfsAddress.slice(0, ipfsAddress.length - 1) + modifiedLastChar;
  // the metadata needs to be deeply cloned here
  // unfortunately `structuredClone` is not available in Node 16
  const modifiedIpfsMetadata = JSON.parse(
    JSON.stringify(storageContractMetadata),
  );
  modifiedIpfsMetadata.sources["project:/contracts/Storage.sol"].urls[1] =
    modifiedIpfsAddress;
  return modifiedIpfsMetadata;
}
