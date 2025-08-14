import { ChildProcess, spawn } from "child_process";
import nock from "nock";
import treeKill from "tree-kill";
import { JsonRpcProvider, JsonRpcSigner, Network } from "ethers";
import { deployFromAbiAndBytecodeForCreatorTxHash } from "./helpers";
import storageContractArtifact from "../testcontracts/Storage/Storage.json";
import storageContractMetadata from "../testcontracts/Storage/metadata.json";
import storageJsonInput from "../testcontracts/Storage/StorageJsonInput.json";
import { loadConfig } from "../../config/Loader";
import type { Metadata } from "@ethereum-sourcify/lib-sourcify";
import path from "path";
import fs from "fs";

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
};

export class LocalChainFixture {
  defaultContractSource = storageContractSource;
  defaultContractModifiedSource = storageModifiedContractSource;
  defaultContractMetadataObject = storageContractMetadata as Metadata;
  defaultContractJsonInput = storageJsonInput;

  private readonly _chainId?: string;
  private _localSigner?: JsonRpcSigner;
  private _defaultContractAddress?: string;
  private _defaultContractCreatorTx?: string;
  private hardhatNodeProcess?: ChildProcess;

  // Getters for type safety
  // Can be safely accessed in "it" blocks
  get chainId(): number {
    if (!this._chainId) throw new Error("chainId not initialized!");
    return Number(this._chainId);
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

  /**
   * Creates a local test chain and deploys the test contract.
   * Expected to be called in a "describe" block.
   */
  constructor(options: LocalChainFixtureOptions = {}) {
    const chains = (loadConfig()).chains
    const localChain = chains[DEFAULT_CHAIN_ID]
    this._chainId = localChain.chainId.toString()

    before(async () => {
      this.hardhatNodeProcess = await startHardhatNetwork(HARDHAT_PORT);

      const ethersNetwork = new Network(
        localChain.rpc[0] as string,
        localChain.chainId,
      );
      this._localSigner = await new JsonRpcProvider(
        `http://localhost:${HARDHAT_PORT}`,
        ethersNetwork,
        { staticNetwork: ethersNetwork },
      ).getSigner();
      console.log("Initialized Provider");

      // Deploy the test contract
      const { contractAddress, txHash } =
        await deployFromAbiAndBytecodeForCreatorTxHash(
          this._localSigner,
          storageContractArtifact.abi,
          storageContractArtifact.bytecode,
        );
      this._defaultContractAddress = contractAddress;
      this._defaultContractCreatorTx = txHash;
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
