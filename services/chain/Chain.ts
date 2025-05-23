import { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { ChainInstance, isConfluxOption } from "../../config/Loader";
import { TransactionReceipt, TransactionResponse } from "ethers";
import { Conflux, format } from "js-conflux-sdk";

export class Chain extends SourcifyChain {
  readonly baseGetTx = this.getTx
  readonly baseGetTxReceipt = this.getTxReceipt
  readonly baseGetBytecode = this.getBytecode
  readonly baseGetContractCreationBytecodeAndReceipt = this.getContractCreationBytecodeAndReceipt
  readonly baseGetCreationBytecodeForFactory = this.getCreationBytecodeForFactory

  readonly confluxSupported: boolean
  readonly confluxSdks: Conflux[]

  constructor(chainObj: ChainInstance) {
    super(chainObj)
    this.confluxSupported = chainObj.confluxSupported
    this.confluxSdks = [];
    if(this.confluxSupported) {
      for (const rpc of chainObj.rpc) {
        let option: string | Conflux.ConfluxOption
        if(typeof rpc === 'string'){
          option = {
            url: rpc,
            networkId: chainObj.networkId | chainObj.chainId,
          } as Conflux.ConfluxOption
        } else if(isConfluxOption(rpc)) {
          option = rpc
        } else{
          throw new Error(`Only support conflux rpc type: string | Conflux.ConfluxOption, got rpc ${JSON.stringify(rpc)}`)
        }
        this.confluxSdks.push(new Conflux(option))
      }
    }
  }

  // override SourcifyChain method
  getSourcifyChainObj = (): ChainInstance => {
    return {
      name: this.name,
      title: this.title,
      chainId: this.chainId,
      rpc: this.rpc,
      rpcWithoutApiKeys: this.rpcWithoutApiKeys,
      supported: this.supported,
      fetchContractCreationTxUsing: this.fetchContractCreationTxUsing,
      etherscanApi: this.etherscanApi,
      traceSupportedRPCs: this.traceSupportedRPCs,
      confluxSupported: this.confluxSupported
    };
  };

  // override SourcifyChain method
  getTx = async (creatorTxHash: string) => {
    if(!this.confluxSupported) {
      return this.baseGetTx(creatorTxHash)
    }

    for (const sdk of this.confluxSdks) {
      try {
        console.info('Fetching tx', {
          creatorTxHash,
          providerUrl: sdk.provider.url,
        });
        const tx = await Promise.race([
          sdk.getTransactionByHash(creatorTxHash),
          this.rejectInMs(sdk.provider.url),
        ]);

        if (!tx) {
          console.warn('Failed to fetch tx', {
            creatorTxHash,
            providerUrl: sdk.provider.url,
            chainId: this.chainId,
            error: `Transaction ${creatorTxHash} not found on RPC ${sdk.provider.url} and chain ${this.chainId}`,
          });
          continue
        }
        const block = await this.getBlockByHash(tx.blockHash)
        console.info('Fetched tx', { creatorTxHash, providerUrl: sdk.provider.url });
        return new TransactionResponse({
          blockNumber: block.blockNumber,
          blockHash: tx.blockHash,
          hash: tx.hash,
          index: tx.transactionIndex,
          type: tx.type,
          to: tx.to,
          from: tx.from,
          nonce: tx.nonce,
          gasLimit: BigInt(tx.gas),
          gasPrice: BigInt(tx.gasPrice),
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : null,
          maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : null,
          data: tx.data,
          value: BigInt(tx.value),
          chainId: BigInt(tx.chainId),
          signature: null,
          accessList: tx.accessList,
        }, null)
      } catch (err) {
          throw err;
      }
    }

    throw new Error(
      'None of the RPCs responded fetching tx ' +
      creatorTxHash +
      ' on chain ' +
      this.chainId,
    );
  };

  // override SourcifyChain method
  getTxReceipt = async (creatorTxHash: string) => {
    if(!this.confluxSupported) {
      return this.baseGetTxReceipt(creatorTxHash)
    }

    for (const sdk of this.confluxSdks) {
      try {
        const rcpt = await Promise.race([
          sdk.getTransactionReceipt(creatorTxHash),
          this.rejectInMs(sdk.provider.url),
        ]);

        if (!rcpt) {
          console.warn('Failed to fetch tx receipt', {
            creatorTxHash,
            providerUrl: sdk.provider.url,
            chainId: this.chainId,
            error: `Transaction's receipt ${creatorTxHash} not found on RPC ${sdk.provider.url} and chain ${this.chainId}`,
          })
          continue
        }

        const block = await this.getBlockByHash(rcpt.blockHash)
        console.info('Fetched tx receipt', {
          creatorTxHash,
          providerUrl: sdk.provider.url,
          chainId: this.chainId,
        });
        return new TransactionReceipt({
          to: rcpt.to,
          from: rcpt.from,
          contractAddress: rcpt.contractCreated,
          hash: rcpt.transactionHash,
          index: rcpt.index,
          blockHash: rcpt.blockHash,
          blockNumber: block.blockNumber,
          logsBloom: rcpt.logsBloom,
          logs: [],
          gasUsed: BigInt(rcpt.gasUsed),
          cumulativeGasUsed: BigInt(0),
          effectiveGasPrice: BigInt(rcpt.effectiveGasPrice),
          type: rcpt.type,
          status: rcpt.outcomeStatus,
          root: rcpt.stateRoot,
        }, null)
      } catch (err) {
        throw err;
      }
    }

    throw new Error(
      'None of the RPCs responded fetching tx ' +
      creatorTxHash +
      ' on chain ' +
      this.chainId,
    );
  };

  // override SourcifyChain method
  getBytecode = async (
    address: string,
    blockNumber?: number,
  ) => {
    if(!this.confluxSupported) {
      return this.baseGetBytecode(address,blockNumber)
    }

    let currentProviderIndex = 0;
    for (const sdk of this.confluxSdks) {
      currentProviderIndex++;
      try {
        console.info('Fetching bytecode', {
          address,
          blockNumber,
          providerUrl: sdk.provider.url,
          chainId: this.chainId,
          currentProviderIndex,
          providersLength: this.providers.length,
        });
        // Race the RPC call with a timeout
        const bytecode = await Promise.race([
          sdk.getCode(address, blockNumber),
          this.rejectInMs(sdk.provider.url),
        ]);
        console.info('Fetched bytecode', {
          address,
          blockNumber,
          bytecodeLength: bytecode.length,
          bytecodeStart: bytecode.slice(0, 32),
          providerUrl: sdk.provider.url,
          chainId: this.chainId,
        });
        return bytecode;
      } catch (err) {
        if (err instanceof Error) {
          console.warn('Failed to fetch bytecode', {
            address,
            blockNumber,
            providerUrl: sdk.provider.url,
            chainId: this.chainId,
            error: err.message,
          });
        } else {
          throw err;
        }
      }
    }
    throw new Error(
      'None of the RPCs responded fetching bytecode for ' +
      address +
      (blockNumber ? ` at block ${blockNumber}` : '') +
      ' on chain ' +
      this.chainId,
    );
  };

  // override SourcifyChain method
  getContractCreationBytecodeAndReceipt = async (
    address: string,
    transactionHash: string,
    creatorTx?: TransactionResponse,
  ) => {
    if(!this.confluxSupported) {
      return this.baseGetContractCreationBytecodeAndReceipt(address,transactionHash,creatorTx)
    }

    const txReceipt = await this.getTxReceipt(transactionHash);
    if (!creatorTx) creatorTx = await this.getTx(transactionHash);

    let creationBytecode: string
    if (txReceipt.contractAddress !== null) {
      if (format.hexAddress(txReceipt.contractAddress) !== format.hexAddress(address)) {
        throw new Error(
          `Address of the contract being verified ${address} doesn't match the address ${txReceipt.contractAddress} created by this transaction ${transactionHash}`,
        );
      }
      creationBytecode = creatorTx.data;
      console.info(`Contract ${address} created with an EOA`);
    } else {
      if (!this.traceSupport) {
        throw new Error(
          `No trace support for chain ${this.chainId}. No other method to get the creation bytecode`,
        );
      }
      console.info(`Contract ${address} created with a factory. Fetching traces`);
      creationBytecode = await this.getCreationBytecodeForFactory(
        transactionHash,
        address,
      );
    }

    return {
      creationBytecode,
      txReceipt,
    };
  };

  // override SourcifyChain method
  getCreationBytecodeForFactory = async (
    creatorTxHash: string,
    address: string,
  ) => {
    if(!this.confluxSupported) {
      return this.baseGetCreationBytecodeForFactory(creatorTxHash, address)
    }

    if (!this.traceSupport || !this.traceSupportedRPCs) {
      throw new Error(`No trace support for chain ${this.chainId}. No other method to get the creation bytecode`);
    }

    for (const traceSupportedRPCObj of this.traceSupportedRPCs) {
      const { type, index } = traceSupportedRPCObj
      if (type !== 'trace_transaction') {
        throw new Error(`No trace support for chain ${this.chainId} in type ${type}.`)
      }
      const sdk = this.confluxSdks[index]
      console.info('Fetching creation bytecode from parity traces', {
        creatorTxHash,
        address,
        providerUrl: sdk.provider.url,
        chainId: this.chainId,
      });
      try {
        return this.extractFromParityTrace(creatorTxHash, address, sdk)
      } catch (e: any) {
        console.info('Failed to fetch creation bytecode from parity traces', {
          creatorTxHash,
          address,
          providerUrl: sdk.provider.url,
          chainId: this.chainId,
          error: e.message,
        });
      }
    }

    throw new Error(
      'Could not get the creation bytecode for factory ' +
      address +
      ' with tx ' +
      creatorTxHash +
      ' on chain ' +
      this.chainId,
    );
  };

  extractFromParityTrace = async (
    creatorTxHash: string,
    address: string,
    sdk: Conflux,
  ) => {
    const traces: any[] = await Promise.race([
      sdk.traceTransaction(creatorTxHash),
      this.rejectInMs(sdk.provider.url),
    ]);
    if (traces instanceof Array && traces.length > 0) {
      console.info('Fetched tx traces', {
        creatorTxHash,
        providerUrl: sdk.provider.url,
        chainId: this.chainId,
      });
    } else {
      throw new Error(
        `Transaction's traces of ${creatorTxHash} on RPC ${sdk.provider.url} and chain ${this.chainId} received empty or malformed response`,
      );
    }

    let createTrace: any
    const createTraces = []
    for (const trace of traces) {
      if(trace.type === 'create') {
        createTraces.push(trace)
      }
      if(trace.type === 'create_result') {
        if((trace.action.addr as string).toLowerCase() === address.toLowerCase()) {
          createTrace = createTraces.pop()
          break
        } else{
          createTraces.pop()
        }
      }
    }
    if (!createTrace) {
      throw new Error(
        `Provided tx ${creatorTxHash} does not create the expected contract ${address}. Created contracts by this tx: ${createTraces.map((t) => t.action.addr).join(', ')}`,
      );
    }
    console.info('Found contract bytecode in traces', {
      address,
      creatorTxHash,
      chainId: this.chainId,
    });

    if (createTrace.action.init) {
      return createTrace.action.init as string;
    } else {
      throw new Error('.action.init not found in traces');
    }
  };

  getBlockByHash = async (blockHash: string, preFetchTxs = false) => {
    for (const sdk of this.confluxSdks) {
      try {
        // Race the RPC call with a timeout
        const block = await Promise.race([
          sdk.getBlockByHash(blockHash, preFetchTxs),
          this.rejectInMs(sdk.provider.url),
        ]);
        if (block) {
          console.info('Fetched block', {
            blockHash,
            blockTimestamp: block.timestamp,
            providerUrl: sdk.provider.url,
            chainId: this.chainId,
          });
        } else {
          console.info('Block not published yet', {
            blockHash,
            providerUrl: sdk.provider.url,
            chainId: this.chainId,
          });
        }
        return block;
      } catch (err: any) {
        console.warn('Failed to fetch the block', {
          blockHash,
          providerUrl: sdk.provider.url,
          chainId: this.chainId,
          error: err.message,
        });
      }
    }
    console.error('None of the RPCs responded for fetching block', {
      blockHash,
      providers: this.providers.map((p) => p.url),
      chainId: this.chainId,
    });
    throw new Error(
      'None of the RPCs responded fetching block ' +
      blockHash +
      ' on chain ' +
      this.chainId,
    );
  };
}
