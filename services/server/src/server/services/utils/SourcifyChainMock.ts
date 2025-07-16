import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { TransactionReceipt, TransactionResponse } from "ethers";
import {
  bytesFromString,
  GetContractDeploymentInfoResult,
} from "./database-util";
import { Database } from "./Database";
import logger from "../../../common/logger";

export default class SourcifyChainMock extends SourcifyChain {
  public contractDeployment?: GetContractDeploymentInfoResult;
  constructor(
    public database: Database,
    public readonly chainId: number,
    private readonly address: string,
    private readonly transactionHash: string,
  ) {
    super({
      name: "SourcifyChainMock",
      chainId: chainId,
      rpc: ["http://mock"],
      supported: true,
    });
    if (!this.database.isPoolInitialized()) {
      logger.error("SourcifyChainMock: database pool not initialized");
      throw new Error("SourcifyChainMock: database pool not initialized");
    }
  }

  async init() {
    const deploymentResult = await this.database.getContractDeploymentInfo(
      this.chainId,
      bytesFromString(this.address),
      bytesFromString(this.transactionHash),
    );
    if (deploymentResult.rows.length === 0) {
      throw new Error("Contract not found");
    }
    this.contractDeployment = deploymentResult.rows[0];
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
