import {
  FetchRequest,
  JsonRpcProvider,
  Network,
  TransactionReceipt,
  TransactionResponse,
  getAddress,
  EthersError,
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

export class RpcFailure extends Error {}

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

  private isRpcBlocked(rpc: SourcifyRpcWithProvider): boolean {
    if (!rpc.health || rpc.health.consecutiveFailures === 0) {
      return false;
    }
    const now = Date.now();
    return (
      rpc.health.nextRetryTime !== undefined && now < rpc.health.nextRetryTime
    );
  }

  private recordRpcSuccess(rpc: SourcifyRpcWithProvider): void {
    if (rpc.health && rpc.health.consecutiveFailures > 0) {
      logInfo('RPC recovered', {
        maskedUrl: rpc.maskedUrl,
        chainId: this.chainId,
        previousFailures: rpc.health.consecutiveFailures,
      });
    }
    rpc.health = {
      consecutiveFailures: 0,
      nextRetryTime: undefined,
    };
  }

  private recordRpcFailure(rpc: SourcifyRpcWithProvider): void {
    const BACKOFF_SCHEDULE = [
      // allow one retry immediately
      0,
      10_000, // 10 seconds
      60_000, // 1 minute
      600_000, // 10 minutes
      3_600_000, // 1 hour
      86_400_000, // 24 hours
    ];

    if (!rpc.health) {
      rpc.health = { consecutiveFailures: 0 };
    }
    rpc.health.consecutiveFailures++;

    const now = Date.now();
    const backoffIndex = Math.min(
      rpc.health.consecutiveFailures - 1,
      BACKOFF_SCHEDULE.length - 1,
    );
    const backoffMs = BACKOFF_SCHEDULE[backoffIndex];
    rpc.health.nextRetryTime = now + backoffMs;
  }

  private async executeWithCircuitBreaker<T>(
    operation: (rpc: SourcifyRpcWithProvider) => Promise<{
      result?: T;
      tryNext?: boolean;
    }>,
    operationName: string,
  ): Promise<T> {
    for (const rpc of this.rpcs) {
      if (!rpc.provider || this.isRpcBlocked(rpc)) {
        continue;
      }

      try {
        const { result, tryNext } = await operation(rpc);

        if (tryNext) {
          // In some cases, the RPC is successful but does not return the desired data
          logDebug('RPC successful but did not return data, trying next RPC', {
            operation: operationName,
            maskedUrl: rpc.maskedUrl,
            chainId: this.chainId,
          });
          // Don't record success here, as RPC might have been skipped in this case
          continue;
        } else if (result !== undefined) {
          this.recordRpcSuccess(rpc);
          return result;
        }
      } catch (error) {
        if (error instanceof RpcFailure) {
          logWarn('RPC operation failed, marking as unhealthy', {
            operation: operationName,
            maskedUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error,
          });
          this.recordRpcFailure(rpc);
          continue;
        }

        logError('RPC operation threw error', {
          operation: operationName,
          error,
          maskedUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        // Don't mark as unhealthy. This is an error that should be handled by the caller.
        throw error;
      }
    }

    logError('All RPCs failed or are blocked', {
      operation: operationName,
      chainId: this.chainId,
    });
    throw new Error(
      `All RPCs failed or are blocked for ${operationName} on chain ${this.chainId}`,
    );
  }

  rejectInMs = (host?: string) =>
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new RpcFailure(`RPC ${host} took too long to respond`)),
        SourcifyChain.rpcTimeout,
      );
    });

  callProviderWithTimeout = async <T>(
    providerPromise: Promise<T>,
    maskedRpcUrl?: string,
  ): Promise<T> => {
    try {
      return await Promise.race([
        providerPromise,
        this.rejectInMs(maskedRpcUrl),
      ]);
    } catch (err) {
      // The code 'SERVER_ERROR' shouldn't be used here because it can be returned if a block is not published yet
      if (
        (err as EthersError)?.code === 'TIMEOUT' ||
        (err as EthersError)?.code === 'NETWORK_ERROR'
      ) {
        throw new RpcFailure(
          (err as EthersError)?.message ||
            'RPC failure: Ethers timeout or network error',
        );
      }
      throw err;
    }
  };

  getTx = async (creatorTxHash: string) => {
    return this.executeWithCircuitBreaker(async (rpc) => {
      if (!rpc.provider) {
        return { tryNext: true };
      }

      logInfo('Fetching tx', {
        creatorTxHash,
        maskedProviderUrl: rpc.maskedUrl,
      });
      const tx = await this.callProviderWithTimeout(
        rpc.provider.getTransaction(creatorTxHash),
        rpc.maskedUrl,
      );

      if (tx instanceof TransactionResponse) {
        logInfo('Fetched tx', {
          creatorTxHash,
          maskedProviderUrl: rpc.maskedUrl,
        });
        return { result: tx };
      } else {
        // RPC did not fail but tx not found
        logWarn('Transaction not found on this RPC', {
          creatorTxHash,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        return { tryNext: true };
      }
    }, `getTx(${creatorTxHash})`);
  };

  getTxReceipt = async (creatorTxHash: string) => {
    return this.executeWithCircuitBreaker(async (rpc) => {
      if (!rpc.provider) {
        return { tryNext: true };
      }

      const receipt = await this.callProviderWithTimeout(
        rpc.provider.getTransactionReceipt(creatorTxHash),
        rpc.maskedUrl,
      );

      if (receipt instanceof TransactionReceipt) {
        logInfo('Fetched tx receipt', {
          creatorTxHash,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        return { result: receipt };
      } else {
        // RPC did not fail but tx receipt not found
        logWarn('Transaction receipt not found on this RPC', {
          creatorTxHash,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        return { tryNext: true };
      }
    }, `getTxReceipt(${creatorTxHash})`);
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

    return this.executeWithCircuitBreaker(async (rpc) => {
      if (!rpc.provider || !rpc.traceSupport) {
        return { tryNext: true };
      }

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
          return { result: creationBytecode };
        } catch (e: any) {
          if (e instanceof RpcFailure) {
            throw e;
          }
          logWarn('Failed to fetch creation bytecode from parity traces', {
            creatorTxHash,
            address,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: e.message,
          });
          return { tryNext: true };
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
          return { result: creationBytecode };
        } catch (e: any) {
          if (e instanceof RpcFailure) {
            throw e;
          }
          logWarn('Failed to fetch creation bytecode from geth traces', {
            creatorTxHash,
            address,
            maskedProviderUrl: rpc.maskedUrl,
            chainId: this.chainId,
            error: e.message,
          });
          return { tryNext: true };
        }
      }

      return { tryNext: true };
    }, `getCreationBytecodeForFactory(${creatorTxHash}, ${address})`);
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

    const traces = await this.callProviderWithTimeout(
      provider.send('trace_transaction', [creatorTxHash]),
      rpc.maskedUrl,
    );

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

    const traces = await this.callProviderWithTimeout(
      provider.send('debug_traceTransaction', [
        creatorTxHash,
        { tracer: 'callTracer' },
      ]),
      rpc.maskedUrl,
    );

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

    return this.executeWithCircuitBreaker(
      async (rpc) => {
        if (!rpc.provider) {
          return { tryNext: true };
        }

        logDebug('Fetching bytecode', {
          address,
          blockNumber,
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });

        const bytecode = await this.callProviderWithTimeout(
          rpc.provider.getCode(address, blockNumber),
          rpc.maskedUrl,
        );
        logInfo('Fetched bytecode', {
          address,
          blockNumber,
          bytecodeLength: bytecode.length,
          bytecodeStart: bytecode.slice(0, 32),
          maskedProviderUrl: rpc.maskedUrl,
          chainId: this.chainId,
        });
        return { result: bytecode };
      },
      `getBytecode(${address}${blockNumber ? ` at block ${blockNumber}` : ''})`,
    );
  };

  getBlock = async (blockNumber: number, preFetchTxs = true) => {
    return this.executeWithCircuitBreaker(async (rpc) => {
      if (!rpc.provider) {
        return { tryNext: true };
      }

      const block = await this.callProviderWithTimeout(
        rpc.provider.getBlock(blockNumber, preFetchTxs),
        rpc.maskedUrl,
      );
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
      return { result: block };
    }, `getBlock(${blockNumber})`);
  };

  getBlockNumber = async () => {
    return this.executeWithCircuitBreaker(async (rpc) => {
      if (!rpc.provider) {
        return { tryNext: true };
      }

      const blockNumber = await this.callProviderWithTimeout(
        rpc.provider.getBlockNumber(),
        rpc.maskedUrl,
      );
      logInfo('Fetched eth_blockNumber', {
        blockNumber,
        maskedProviderUrl: rpc.maskedUrl,
        chainId: this.chainId,
      });
      return { result: blockNumber };
    }, 'getBlockNumber');
  };

  getStorageAt = async (address: string, position: number | string) => {
    return this.executeWithCircuitBreaker(async (rpc) => {
      if (!rpc.provider) {
        return { tryNext: true };
      }

      const data = await this.callProviderWithTimeout(
        rpc.provider.getStorage(address, position),
        rpc.maskedUrl,
      );
      logInfo('Fetched eth_getStorageAt', {
        address,
        position,
        maskedProviderUrl: rpc.maskedUrl,
        chainId: this.chainId,
      });
      return { result: data };
    }, `getStorageAt(${address}, ${position})`);
  };

  call = async (transaction: { to: string; data: string }) => {
    return this.executeWithCircuitBreaker(async (rpc) => {
      if (!rpc.provider) {
        return { tryNext: true };
      }

      const callResult = await this.callProviderWithTimeout(
        rpc.provider.call(transaction),
        rpc.maskedUrl,
      );
      logInfo('Fetched eth_call result', {
        tx: transaction,
        maskedProviderUrl: rpc.maskedUrl,
        chainId: this.chainId,
      });
      return { result: callResult };
    }, `call(${transaction.to})`);
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
