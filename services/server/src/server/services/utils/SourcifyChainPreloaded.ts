import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { getAddress } from "ethers";

export class SourcifyChainPreloaded extends SourcifyChain {
  private readonly checksumAddress: string;

  constructor(
    private readonly baseChain: SourcifyChain,
    address: string,
    private readonly runtimeBytecode: string,
  ) {
    super(baseChain.getSourcifyChainObj());
    this.checksumAddress = getAddress(address);
  }

  getBytecode = async (
    address: string,
    blockNumber?: number,
  ): Promise<string> => {
    if (!blockNumber && getAddress(address) === this.checksumAddress) {
      return this.runtimeBytecode;
    }
    return this.baseChain.getBytecode(address, blockNumber);
  };

  getTx = async (transactionHash: string) => {
    return this.baseChain.getTx(transactionHash);
  };

  getContractCreationBytecodeAndReceipt = async (
    address: string,
    transactionHash: string,
    creatorTx?: Parameters<SourcifyChain["getContractCreationBytecodeAndReceipt"]>[2],
  ) => {
    return this.baseChain.getContractCreationBytecodeAndReceipt(
      address,
      transactionHash,
      creatorTx,
    );
  };
}
