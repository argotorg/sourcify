import {
  FetchRequest,
  JsonRpcProvider,
  Network,
  TransactionReceipt,
  TransactionResponse,
  getAddress,
} from 'ethers';
import { logDebug, logError, logInfo, logWarn } from '../logger';
import {
  CallFrame,
  FetchContractCreationTxMethods,
  FetchRequestRPC,
  SourcifyChainInstance,
  SourcifyRpc,
} from './SourcifyChainTypes';

type SourcifyRpcWithProvider = SourcifyRpc & {
  provider?: JsonRpcProvider;
};

export function createFetchRequest(rpc: FetchRequestRPC): FetchRequest {
  const ethersFetchReq = new FetchRequest(rpc.url);
  ethersFetchReq.setHeader('Content-Type', 'application/json');
  const headers = rpc.headers;
  if (headers) {
    headers.forEach(({ headerName, headerValue }) => {
      ethersFetchReq.setHeader(headerName, headerValue);
    });
  }
  return ethersFetchReq;
}

export type SourcifyChainMap = {
  [chainId: string]: SourcifyChain;
};

export class SourcifyChain {
  name: string;
  readonly title?: string | undefined;
  readonly chainId: number;
  readonly rpcs: SourcifyRpcWithProvider[];
  /** Whether the chain supports tracing, used for fetching the creation bytecode for factory contracts */
  readonly traceSupport?: boolean;
  readonly supported: boolean;
  readonly fetchContractCreationTxUsing?: FetchContractCreationTxMethods;
  readonly etherscanApi?: {
    supported: boolean;
    apiKeyEnvName?: string;
  };

  private static rpcTimeout: number = 10 * 1000;

  /**
   * Sets the global RPC timeout for all SourcifyChain instances
   * @param timeoutMs Timeout in milliseconds
   */
  public static setGlobalRpcTimeout(timeoutMs: number): void {
    SourcifyChain.rpcTimeout = timeoutMs;
  }

  public static getGlobalRpcTimeout(): number {
    return SourcifyChain.rpcTimeout;
  }

  constructor(sourcifyChainObj: SourcifyChainInstance) {
    this.name = sourcifyChainObj.name;
    this.title = sourcifyChainObj.title;
    this.chainId = sourcifyChainObj.chainId;
    this.supported = sourcifyChainObj.supported;
    this.fetchContractCreationTxUsing =
      sourcifyChainObj.fetchContractCreationTxUsing;
    this.etherscanApi = sourcifyChainObj.etherscanApi;

    this.rpcs = sourcifyChainObj.rpcs;
    this.traceSupport = this.rpcs.some((r) => r.traceSupport !== undefined);

    if (!this.supported) return; // Don't create providers if chain is not supported

    if (!this.rpcs.length)
      throw new Error(
        'No RPC provider was given for this chain with id ' +
          this.chainId +
          ' and name ' +
          this.name,
      );

    // Create providers and store them in rpcs
    for (const sourcifyRpc of this.rpcs) {
      const rpc = sourcifyRpc.rpc;
      let provider: JsonRpcProvider | undefined;
      const ethersNetwork = new Network(this.name, this.chainId);
      if (typeof rpc === 'string') {
        if (rpc.startsWith('http')) {
          // Use staticNetwork to avoid sending unnecessary eth_chainId requests
          provider = new JsonRpcProvider(rpc, ethersNetwork, {
            staticNetwork: ethersNetwork,
          });
        } else {
          // Do not use WebSockets because of not being able to catch errors on websocket initialization. Most networks don't support WebSockets anyway. See https://github.com/ethers-io/ethers.js/discussions/2896
        }
      } else {
        // else: rpc is of type FetchRequestRPC
        // Build ethers.js FetchRequest object for custom rpcs with auth headers
        const ethersFetchReq = createFetchRequest(rpc);
        provider = new JsonRpcProvider(ethersFetchReq, ethersNetwork, {
          staticNetwork: ethersNetwork,
        });
      }
      sourcifyRpc.provider = provider;
    }
  }

  getSourcifyChainObj = (): SourcifyChainInstance => {
    return {
      name: this.name,
      title: this.title,
      chainId: this.chainId,
      // eslint-disable-next-line
      rpcs: this.rpcs.map(({ provider: _provider, ...rest }) => rest), // SourcifyChainInstance should not include class instances
      supported: this.supported,
      fetchContractCreationTxUsing: this.fetchContractCreationTxUsing,
      etherscanApi: this.etherscanApi,
    };
  };

  rejectInMs = (host?: string) =>
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error(`RPC ${host} took too long to respond`)),
        SourcifyChain.rpcTimeout,
      );
    });

  getTx = async (creatorTxHash: string) => {
    // Try sequentially all RPCs
    for (const rpc of this.rpcs) {
      if (!rpc.provider) continue;
      const provider = rpc.provider;
      try {
        logInfo('Fetching tx', {
          creatorTxHash,
          maskedProviderUrl: rpc.maskedUrl,
        });
        // Race the RPC call with a timeout
        const tx = await Promise.race([
          provider.getTransaction(creatorTxHash),
          this.rejectInMs(rpc.maskedUrl),
        ]);
        if (tx instanceof TransactionResponse) {
          logInfo('Fetched tx', {
            creatorTxHash,
            maskedProviderUrl: rpc.maskedUrl,
          });
          return tx;
        } else {
          throw new Error(
            `Transaction ${creatorTxHash} not found on RPC ${rpc.maskedUrl} and chain ${this.chainId}`,
          );
        }
      } catch (err) {
        if (err instanceof Error) {
          logWarn('Failed to fetch tx', {
            creatorTxHash,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: err.message,
          });
          continue;
        } else {
          throw err;
        }
      }
    }
    throw new Error(
      'None of the RPCs responded fetching tx ' +
        creatorTxHash +
        ' on chain ' +
        this.chainId,
    );
  };

  getTxReceipt = async (creatorTxHash: string) => {
    // Try sequentially all RPCs
    for (const rpc of this.rpcs) {
      if (!rpc.provider) continue;
      const provider = rpc.provider;
      try {
        // Race the RPC call with a timeout
        const tx = await Promise.race([
          provider.getTransactionReceipt(creatorTxHash),
          this.rejectInMs(rpc.maskedUrl),
        ]);
        if (tx instanceof TransactionReceipt) {
          logInfo('Fetched tx receipt', {
            creatorTxHash,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
          });
          return tx;
        } else {
          throw new Error(
            `Transaction's receipt ${creatorTxHash} not found on RPC ${rpc.maskedUrl} and chain ${this.chainId}`,
          );
        }
      } catch (err) {
        if (err instanceof Error) {
          logWarn('Failed to fetch tx receipt', {
            creatorTxHash,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: err.message,
          });
          continue;
        } else {
          throw err;
        }
      }
    }
    throw new Error(
      'None of the RPCs responded fetching tx ' +
        creatorTxHash +
        ' on chain ' +
        this.chainId,
    );
  };

  /**
   * Tries to fetch the creation bytecode for a factory contract with the available methods.
   * Not limited to traces but might fetch it from other resources too.
   */
  getCreationBytecodeForFactory = async (
    creatorTxHash: string,
    address: string,
  ) => {
    // TODO: Alternative methods e.g. getting from Coleslaw. Not only traces.

    if (!this.traceSupport) {
      throw new Error(
        `No trace support for chain ${this.chainId}. No other method to get the creation bytecode`,
      );
    }

    // Try sequentially all RPCs with trace support
    for (const rpc of this.rpcs) {
      if (!rpc.traceSupport || !rpc.provider) continue;

      const { traceSupport: type } = rpc;

      // Parity type `trace_transaction`
      if (type === 'trace_transaction') {
        logDebug('Fetching creation bytecode from parity traces', {
          creatorTxHash,
          address,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        try {
          const creationBytecode = await this.extractFromParityTraceProvider(
            creatorTxHash,
            address,
            rpc,
          );
          return creationBytecode;
        } catch (e: any) {
          // Catch to continue with the next provider
          logWarn('Failed to fetch creation bytecode from parity traces', {
            creatorTxHash,
            address,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: e.message,
          });
          continue;
        }
      }
      // Geth type `debug_traceTransaction`
      else if (type === 'debug_traceTransaction') {
        logDebug('Fetching creation bytecode from geth traces', {
          creatorTxHash,
          address,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        try {
          const creationBytecode = await this.extractFromGethTraceProvider(
            creatorTxHash,
            address,
            rpc,
          );
          return creationBytecode;
        } catch (e: any) {
          // Catch to continue with the next provider
          logWarn('Failed to fetch creation bytecode from geth traces', {
            creatorTxHash,
            address,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: e.message,
          });
          continue;
        }
      }
    }
    throw new Error(
      'Couldnt get the creation bytecode for factory ' +
        address +
        ' with tx ' +
        creatorTxHash +
        ' on chain ' +
        this.chainId,
    );
  };

  /**
   * For Parity style traces `trace_transaction`
   * Extracts the creation bytecode from the traces of a transaction
   */
  extractFromParityTraceProvider = async (
    creatorTxHash: string,
    address: string,
    rpc: SourcifyRpcWithProvider,
  ) => {
    if (!rpc.provider) throw new Error('No provider found in rpc');
    const provider = rpc.provider;
    // Race the RPC call with a timeout
    const traces = await Promise.race([
      provider.send('trace_transaction', [creatorTxHash]),
      this.rejectInMs(rpc.maskedUrl),
    ]);
    if (traces instanceof Array && traces.length > 0) {
      logInfo('Fetched tx traces', {
        creatorTxHash,
        maskedProviderUrl: rpc.maskedUrl,
        chainId: this.chainId,
      });
    } else {
      throw new Error(
        `Transaction's traces of ${creatorTxHash} on RPC ${rpc.maskedUrl} and chain ${this.chainId} received empty or malformed response`,
      );
    }

    const createTraces = traces.filter((trace: any) => trace.type === 'create');
    // This line makes sure the tx in question is indeed for the contract being verified and not a random tx.
    const contractTrace = createTraces.find(
      (trace) =>
        (trace.result.address as string).toLowerCase() ===
        address.toLowerCase(),
    );
    if (!contractTrace) {
      throw new Error(
        `Provided tx ${creatorTxHash} does not create the expected contract ${address}. Created contracts by this tx: ${createTraces.map((t) => t.result.address).join(', ')}`,
      );
    }
    logDebug('Found contract bytecode in traces', {
      address,
      creatorTxHash,
      chainId: this.chainId,
    });
    if (contractTrace.action.init) {
      return contractTrace.action.init as string;
    } else {
      throw new Error('.action.init not found in traces');
    }
  };

  extractFromGethTraceProvider = async (
    creatorTxHash: string,
    address: string,
    rpc: SourcifyRpcWithProvider,
  ) => {
    if (!rpc.provider) throw new Error('No provider found in rpc');
    const provider = rpc.provider;
    const traces = await Promise.race([
      provider.send('debug_traceTransaction', [
        creatorTxHash,
        { tracer: 'callTracer' },
      ]),
      this.rejectInMs(rpc.maskedUrl),
    ]);
    if (traces?.calls instanceof Array && traces.calls.length > 0) {
      logInfo('Fetched tx traces', {
        creatorTxHash,
        maskedProviderUrl: rpc.maskedUrl,
        chainId: this.chainId,
      });
    } else {
      throw new Error(
        `Transaction's traces of ${creatorTxHash} on RPC ${rpc.maskedUrl} and chain ${this.chainId} received empty or malformed response`,
      );
    }

    const createCalls: CallFrame[] = [];
    this.findCreateInDebugTraceTransactionCalls(
      traces.calls as CallFrame[],
      createCalls,
    );

    if (createCalls.length === 0) {
      throw new Error(
        `No CREATE or CREATE2 calls found in the traces of ${creatorTxHash} on RPC ${rpc.maskedUrl} and chain ${this.chainId}`,
      );
    }

    // A call can have multiple contracts created. We need the one that matches the address we are verifying.
    const ourCreateCall = createCalls.find(
      (createCall) => createCall.to.toLowerCase() === address.toLowerCase(),
    );

    if (!ourCreateCall) {
      throw new Error(
        `No CREATE or CREATE2 call found for the address ${address} in the traces of ${creatorTxHash} on RPC ${rpc.maskedUrl} and chain ${this.chainId}`,
      );
    }

    return ourCreateCall.input;
  };

  /**
   * Find CREATE or CREATE2 operations recursively in the call frames. Because a call can have nested calls.
   * Pushes the found call frames to the createCalls array.
   */
  findCreateInDebugTraceTransactionCalls(
    calls: CallFrame[],
    createCalls: CallFrame[],
  ) {
    calls.forEach((call) => {
      if (call?.type === 'CREATE' || call?.type === 'CREATE2') {
        createCalls.push(call);
      } else if (call?.calls?.length > 0) {
        this.findCreateInDebugTraceTransactionCalls(call.calls, createCalls);
      }
    });
  }
  /**
   * Fetches the contract's deployed bytecode from SourcifyChain's rpc's.
   * Tries to fetch sequentially if the first RPC is a local eth node. Fetches in parallel otherwise.
   *
   * @param {SourcifyChain} sourcifyChain - chain object with rpc's
   * @param {string} address - contract address
   */
  getBytecode = async (
    address: string,
    blockNumber?: number,
  ): Promise<string> => {
    address = getAddress(address);

    // Request sequentially. Custom node is always before ALCHEMY so we don't waste resources if succeeds.
    for (const rpc of this.rpcs) {
      if (!rpc.provider) continue;
      const provider = rpc.provider;
      try {
        logDebug('Fetching bytecode', {
          address,
          blockNumber,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        // Race the RPC call with a timeout
        const bytecode = await Promise.race([
          provider.getCode(address, blockNumber),
          this.rejectInMs(rpc.maskedUrl),
        ]);
        logInfo('Fetched bytecode', {
          address,
          blockNumber,
          bytecodeLength: bytecode.length,
          bytecodeStart: bytecode.slice(0, 32),
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        return bytecode;
      } catch (err) {
        if (err instanceof Error) {
          logWarn('Failed to fetch bytecode', {
            address,
            blockNumber,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: err.message,
          });
          continue;
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

  getBlock = async (blockNumber: number, preFetchTxs = true) => {
    // Request sequentially. Custom node is always before ALCHEMY so we don't waste resources if succeeds.
    for (const rpc of this.rpcs) {
      if (!rpc.provider) continue;
      const provider = rpc.provider;
      try {
        // Race the RPC call with a timeout
        const block = await Promise.race([
          provider.getBlock(blockNumber, preFetchTxs),
          this.rejectInMs(rpc.maskedUrl),
        ]);
        if (block) {
          logInfo('Fetched block', {
            blockNumber,
            blockTimestamp: block.timestamp,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
          });
        } else {
          logInfo('Block not published yet', {
            blockNumber,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
          });
        }
        return block;
      } catch (err: any) {
        logWarn('Failed to fetch the block', {
          blockNumber,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
          error: err.message,
        });
        continue;
      }
    }
    logError('None of the RPCs responded for fetching block', {
      blockNumber,
      rpcs: this.rpcs.map((r) => r.maskedUrl),
      chainId: this.chainId,
    });
    throw new Error(
      'None of the RPCs responded fetching block ' +
        blockNumber +
        ' on chain ' +
        this.chainId,
    );
  };

  getBlockNumber = async () => {
    // Request sequentially. Custom node is always before ALCHEMY so we don't waste resources if succeeds.
    for (const rpc of this.rpcs) {
      if (!rpc.provider) continue;
      const provider = rpc.provider;
      try {
        // Race the RPC call with a timeout
        const block = await Promise.race([
          provider.getBlockNumber(),
          this.rejectInMs(rpc.maskedUrl),
        ]);
        logInfo('Fetched eth_blockNumber', {
          blockNumber: block,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        return block;
      } catch (err) {
        if (err instanceof Error) {
          logWarn('Failed to fetch eth_blockNumber', {
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: err.message,
          });
          continue;
        } else {
          throw err;
        }
      }
    }
    throw new Error(
      'None of the RPCs responded fetching the blocknumber on chain ' +
        this.chainId,
    );
  };

  getStorageAt = async (address: string, position: number | string) => {
    // Request sequentially. Custom node is always before ALCHEMY so we don't waste resources if succeeds.
    for (const rpc of this.rpcs) {
      if (!rpc.provider) continue;
      const provider = rpc.provider;
      try {
        // Race the RPC call with a timeout
        const data = await Promise.race([
          provider.getStorage(address, position),
          this.rejectInMs(rpc.maskedUrl),
        ]);
        logInfo('Fetched eth_getStorageAt', {
          address,
          position,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        return data;
      } catch (err) {
        if (err instanceof Error) {
          logWarn('Failed to fetch eth_getStorageAt', {
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: err.message,
          });
          continue;
        } else {
          throw err;
        }
      }
    }
    throw new Error(
      'None of the RPCs responded fetching the storage slot on chain ' +
        this.chainId,
    );
  };

  call = async (transaction: { to: string; data: string }) => {
    // Request sequentially. Custom node is always before ALCHEMY so we don't waste resources if succeeds.
    for (const rpc of this.rpcs) {
      if (!rpc.provider) continue;
      const provider = rpc.provider;
      try {
        // Race the RPC call with a timeout
        const callResult = await Promise.race([
          provider.call(transaction),
          this.rejectInMs(rpc.maskedUrl),
        ]);
        logInfo('Fetched eth_call result', {
          tx: transaction,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        return callResult;
      } catch (err) {
        if (err instanceof Error) {
          logWarn('Failed to fetch eth_call result', {
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: err.message,
          });
          continue;
        } else {
          throw err;
        }
      }
    }
    throw new Error(
      'None of the RPCs responded with eth_call result on chain ' +
        this.chainId,
    );
  };

  getContractCreationBytecodeAndReceipt = async (
    address: string,
    transactionHash: string,
    creatorTx?: TransactionResponse,
  ): Promise<{
    creationBytecode: string;
    txReceipt: TransactionReceipt;
  }> => {
    const txReceipt = await this.getTxReceipt(transactionHash);
    if (!creatorTx) creatorTx = await this.getTx(transactionHash);

    let creationBytecode;
    // Non null txreceipt.contractAddress means that the contract was created with an EOA
    if (txReceipt.contractAddress !== null) {
      if (txReceipt.contractAddress !== address) {
        // we need to check if this contract creation tx actually yields the same contract address https://github.com/argotorg/sourcify/issues/887
        throw new Error(
          `Address of the contract being verified ${address} doesn't match the address ${txReceipt.contractAddress} created by this transaction ${transactionHash}`,
        );
      }
      creationBytecode = creatorTx.data;
      logDebug(`Contract ${address} created with an EOA`);
    } else {
      // Else, contract was created with a factory
      if (!this.traceSupport) {
        throw new Error(
          `No trace support for chain ${this.chainId}. No other method to get the creation bytecode`,
        );
      }
      logDebug(`Contract ${address} created with a factory. Fetching traces`);
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
}
