import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { TransactionReceipt, TransactionResponse } from "ethers";
import {
  bytesFromString,
  GetSourcifyMatchByChainAddressWithPropertiesResult,
} from "./database-util";
import { Database } from "./Database";
import logger from "../../../common/logger";

export default class SourcifyChainMock extends SourcifyChain {
  constructor(
    public contractDeployment: GetSourcifyMatchByChainAddressWithPropertiesResult,
    public readonly chainId: number,
    private readonly address: string,
  ) {
    super({
      name: "SourcifyChainMock",
      chainId: chainId,
      rpcs: [
        {
          rpc: "http://mock",
        },
      ],
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
    const contractDeployment =
      await database.getSourcifyMatchByChainAddressWithProperties(
        chainId,
        bytesFromString(address),
        [
          "address",
          "transaction_hash",
          "block_number",
          "transaction_index",
          "deployer",
          "onchain_creation_code",
          "onchain_runtime_code",
        ],
      );

    if (contractDeployment.rows.length === 0) {
      throw new Error("Contract not found");
    }
    const sourcifyChainMock = new SourcifyChainMock(
      contractDeployment.rows[0],
      chainId,
      address,
    );
    return sourcifyChainMock;
  }

  getBytecode = async () => {
    if (!this.contractDeployment) {
      throw new Error("SourcifyChainMock not initialized yet");
    }
    return this.contractDeployment.onchain_runtime_code || "";
  };

  getTx = async () => {
    if (!this.contractDeployment) {
      throw new Error("SourcifyChainMock not initialized yet");
    }
    return {
      blockNumber: this.contractDeployment.block_number,
      from: this.contractDeployment.deployer,
    } as TransactionResponse;
  };

  getContractCreationBytecodeAndReceipt = async () => {
    if (!this.contractDeployment) {
      throw new Error("SourcifyChainMock not initialized yet");
    }
    return {
      creationBytecode: this.contractDeployment.onchain_creation_code || "",
      txReceipt: {
        index: this.contractDeployment.transaction_index || 0,
      } as TransactionReceipt,
    };
  };
}
