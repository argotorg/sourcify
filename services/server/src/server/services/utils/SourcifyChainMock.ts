import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { TransactionReceipt, TransactionResponse } from "ethers";
import {
  bytesFromString,
  GetContractDeploymentInfoResult,
} from "./database-util";
import { Database } from "./Database";
import logger from "../../../common/logger";

export default class SourcifyChainMock extends SourcifyChain {
  constructor(
    public contractDeployment: GetContractDeploymentInfoResult,
    public readonly chainId: number,
    private readonly address: string,
  ) {
    super({
      name: "SourcifyChainMock",
      chainId: chainId,
      rpc: ["http://mock"],
      supported: true,
    });
  }

  static async create(
    database: Database,
    chainId: number,
    address: string,
  ): Promise<SourcifyChainMock> {
    if (!database.isPoolInitialized()) {
      logger.error("SourcifyChainMock: database pool not initialized");
      throw new Error("SourcifyChainMock: database pool not initialized");
    }
    const deploymentResult = await database.getContractDeploymentInfo(
      chainId,
      bytesFromString(address),
    );
    if (deploymentResult.rows.length === 0) {
      throw new Error("Contract not found");
    }
    const sourcifyChainMock = new SourcifyChainMock(
      deploymentResult.rows[0],
      chainId,
      address,
    );
    return sourcifyChainMock;
  }

  getBytecode = async () => {
    if (!this.contractDeployment) {
      throw new Error("SourcifyChainMock not initialized yet");
    }
    return `0x${this.contractDeployment.onchain_runtime_code.toString("hex")}`;
  };

  getTx = async () => {
    if (!this.contractDeployment) {
      throw new Error("SourcifyChainMock not initialized yet");
    }
    return {
      blockNumber: this.contractDeployment.block_number,
      from: `0x${this.contractDeployment.deployer?.toString("hex")}`,
    } as TransactionResponse;
  };

  getContractCreationBytecodeAndReceipt = async () => {
    if (!this.contractDeployment) {
      throw new Error("SourcifyChainMock not initialized yet");
    }
    return {
      creationBytecode: `0x${this.contractDeployment.onchain_creation_code.toString("hex")}`,
      txReceipt: {
        index: this.contractDeployment.transaction_index,
      } as TransactionReceipt,
    };
  };
}
