import type { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { StatusCodes } from "http-status-codes";
import logger from "../../../common/logger";

const ETHERSCAN_API =
  "https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}&module=contract&action=getcontractcreation&contractaddresses=${ADDRESS}&apikey=";
const BLOCKSSCAN_SUFFIX = "api/accounts/${ADDRESS}";
const BLOCKSCOUT_API_SUFFIX = "/api/v2/addresses/${ADDRESS}";
const TELOS_SUFFIX = "v1/contract/${ADDRESS}";
const AVALANCHE_SUBNET_SUFFIX =
  "contracts/${ADDRESS}/transactions:getDeployment";
const NEXUS_SUFFIX = "v1/${RUNTIME}/accounts/${ADDRESS}";
const ROUTESCAN_API_URL =
  "https://api.routescan.io/v2/network/${CHAIN_TYPE}/evm/${CHAIN_ID}/etherscan/api?module=contract&action=getcontractcreation&contractaddresses=${ADDRESS}";
const VECHAIN_API_URL =
  "https://api.vechainstats.com/v2/contract/info?address=${ADDRESS}&expanded=true&VCS_API_KEY=";

export const BINARY_SEARCH_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

interface ContractCreationFetcher {
  type: "api";
  url: string;
  maskedUrl?: string;
  responseParser?: Function;
}

function getApiContractCreationFetcher(
  url: string,
  responseParser: Function,
  maskedUrl?: string,
): ContractCreationFetcher {
  return {
    type: "api",
    url,
    maskedUrl: maskedUrl || url,
    responseParser,
  };
}

function getEtherscanApiContractCreatorFetcher(
  apiKey: string,
  chainId: number,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    ETHERSCAN_API.replace("${CHAIN_ID}", chainId.toString()) + apiKey,
    (response: any) => {
      if (response?.message === "NOTOK")
        throw new Error(`Etherscan API error: ${response?.result}`);
      if (response?.result?.[0]?.txHash)
        return response?.result?.[0]?.txHash as string;
    },
    ETHERSCAN_API.replace("${CHAIN_ID}", chainId.toString()),
  );
}

function getBlockscoutApiContractCreatorFetcher(
  apiURL: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    apiURL + BLOCKSCOUT_API_SUFFIX,
    (response: any) =>
      response?.creation_tx_hash || response?.creation_transaction_hash,
  );
}

function getRoutescanApiContractCreatorFetcher(
  type: "mainnet" | "testnet",
  chainId: number,
): ContractCreationFetcher {
  // Don't replace ${ADDRESS} because it's done inside getCreatorTxUsingFetcher()
  const url = ROUTESCAN_API_URL.replace("${CHAIN_TYPE}", type).replace(
    "${CHAIN_ID}",
    chainId.toString(),
  );
  return getApiContractCreationFetcher(
    url,
    (response: any) => response?.result?.[0]?.txHash,
  );
}

function getBlocksScanApiContractCreatorFetcher(
  apiURL: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    apiURL + BLOCKSSCAN_SUFFIX,
    (response: any) => {
      if (response.fromTxn) return response.fromTxn as string;
    },
  );
}

function getTelosApiContractCreatorFetcher(
  apiURL: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    apiURL + TELOS_SUFFIX,
    (response: any) => {
      if (response?.results?.[0]?.transaction)
        return response.results[0].transaction as string;
    },
  );
}

function getAvalancheApiContractCreatorFetcher(
  chainId: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    `https://glacier-api.avax.network/v1/chains/${chainId}/${AVALANCHE_SUBNET_SUFFIX}`,
    (response: any) => {
      if (response.nativeTransaction?.txHash)
        return response.nativeTransaction.txHash as string;
    },
  );
}

function getNexusApiContractCreatorFetcher(
  apiURL: string,
  runtime: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    apiURL + NEXUS_SUFFIX.replace("${RUNTIME}", runtime),
    (response: any) => {
      if (response.evm_contract?.eth_creation_tx)
        return `0x${response.evm_contract.eth_creation_tx}`;
    },
  );
}

function getVeChainApiContractCreatorFetcher(
  apiKey: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    VECHAIN_API_URL + apiKey,
    (response: any) => {
      if (response?.data?.creation_txid)
        return response.data.creation_txid as string;
    },
    VECHAIN_API_URL,
  );
}

async function getCreatorTxUsingNodeReal(
  url: string,
  contractAddress: string,
  apiKey: string,
): Promise<string | null> {
  const endpoint = url.replace("${API_KEY}", apiKey);
  const maskedEndpoint = url.replace("${API_KEY}", "****");
  logger.debug("Fetching Creator Tx from NodeReal", {
    maskedEndpoint,
    contractAddress,
  });
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "nr_getContractCreationTransaction",
      params: [contractAddress],
      id: 1,
    }),
  });
  if (res.status !== StatusCodes.OK) {
    throw new Error(`NodeReal API returned status ${res.status}`);
  }
  const response = await res.json();
  if (response?.result?.hash) {
    return response.result.hash as string;
  }
  logger.debug("NodeReal API returned no creation tx", {
    contractAddress,
    response,
  });
  return null;
}

async function getCreatorTxUsingFetcher(
  fetcher: ContractCreationFetcher,
  contractAddress: string,
) {
  if (fetcher === undefined) {
    return null;
  }

  const contractFetchAddressFilled = fetcher?.url.replace(
    "${ADDRESS}",
    contractAddress,
  );

  logger.debug("Fetching Creator Tx", {
    fetcherUrl: fetcher?.maskedUrl,
    contractFetchAddressFilled,
    contractAddress,
  });

  if (!contractFetchAddressFilled) return null;

  try {
    if (fetcher?.responseParser) {
      const response = await fetchFromApi(contractFetchAddressFilled);
      const creatorTx = fetcher?.responseParser(response);
      if (creatorTx) {
        logger.debug("Fetched Creator Tx", {
          fetcherUrl: fetcher?.maskedUrl,
          contractFetchAddressFilled,
          contractAddress,
          creatorTx,
        });
        return creatorTx;
      }
    }
  } catch (e: any) {
    logger.warn("Error while getting creation transaction", {
      fetcherUrl: fetcher?.maskedUrl,
      error: e.message,
    });
    return null;
  }

  return null;
}

/**
 * Finds the transaction that created the contract by either scraping a block explorer or querying a provided API.
 *
 * @param sourcifyChain
 * @param address
 * @returns
 */
export const getCreatorTx = async (
  sourcifyChain: SourcifyChain,
  contractAddress: string,
): Promise<string | null> => {
  // Try blockscout first
  if (sourcifyChain.fetchContractCreationTxUsing?.blockscoutApi) {
    const fetcher = getBlockscoutApiContractCreatorFetcher(
      sourcifyChain.fetchContractCreationTxUsing?.blockscoutApi.url,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  // Try routescan if blockscout fails
  if (sourcifyChain.fetchContractCreationTxUsing?.routescanApi) {
    const fetcher = getRoutescanApiContractCreatorFetcher(
      sourcifyChain.fetchContractCreationTxUsing?.routescanApi.type,
      sourcifyChain.chainId,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  // Try NodeReal API if routescan fails
  if (
    sourcifyChain.fetchContractCreationTxUsing?.nodeRealApi &&
    process.env.NODEREAL_API_KEY
  ) {
    try {
      const result = await getCreatorTxUsingNodeReal(
        sourcifyChain.fetchContractCreationTxUsing.nodeRealApi.url,
        contractAddress,
        process.env.NODEREAL_API_KEY,
      );
      if (result) {
        return result;
      }
    } catch (e: any) {
      logger.warn("Error fetching creation tx from NodeReal", {
        error: e.message,
      });
    }
  }

  // Try etherscan if NodeReal fails
  if (
    sourcifyChain.fetchContractCreationTxUsing?.etherscanApi &&
    sourcifyChain?.etherscanApi?.supported
  ) {
    const apiKey =
      process.env[sourcifyChain.etherscanApi.apiKeyEnvName || ""] ||
      process.env.ETHERSCAN_API_KEY ||
      "";
    const fetcher = getEtherscanApiContractCreatorFetcher(
      apiKey,
      sourcifyChain.chainId,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }
  if (sourcifyChain.fetchContractCreationTxUsing?.avalancheApi) {
    const fetcher = getAvalancheApiContractCreatorFetcher(
      sourcifyChain.chainId.toString(),
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  if (sourcifyChain.fetchContractCreationTxUsing?.blocksScanApi) {
    const fetcher = getBlocksScanApiContractCreatorFetcher(
      sourcifyChain.fetchContractCreationTxUsing?.blocksScanApi.url,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }
  if (sourcifyChain.fetchContractCreationTxUsing?.telosApi) {
    const fetcher = getTelosApiContractCreatorFetcher(
      sourcifyChain.fetchContractCreationTxUsing?.telosApi.url,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }
  if (sourcifyChain.fetchContractCreationTxUsing?.nexusApi) {
    const fetcher = getNexusApiContractCreatorFetcher(
      sourcifyChain.fetchContractCreationTxUsing?.nexusApi.url,
      sourcifyChain.fetchContractCreationTxUsing?.nexusApi.runtime,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  if (
    sourcifyChain.fetchContractCreationTxUsing?.veChainApi &&
    process.env.VECHAIN_STATS_API_KEY
  ) {
    const fetcher = getVeChainApiContractCreatorFetcher(
      process.env.VECHAIN_STATS_API_KEY,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  logger.debug("Trying binary search to find contract creation transaction", {
    contractAddress,
  });
  const result = await findContractCreationTxByBinarySearchWithTimeout(
    sourcifyChain,
    contractAddress,
  );
  if (result) {
    return result;
  }

  logger.warn("Couldn't fetch creator tx", {
    chainId: sourcifyChain.chainId,
    contractAddress,
  });

  return null;
};

async function fetchFromApi(fetchAddress: string) {
  const res = await fetch(fetchAddress);
  if (res.status === StatusCodes.OK) {
    const response = await res.json();
    return response;
  }

  throw new Error(
    `Contract creator tx could not be fetched from ${fetchAddress} because of status code ${res.status}`,
  );
}

/**
 * Finds the transaction that created the contract by lower bound binary searching through the blocks.
 * Calls `eth_getCode` on the middle blocks to see if the contract has code. If yes, the contract should be created before this block. If no code, the contract should be created after this block.
 * Once the block is found, searches through all the tx's of the block to see if any of them created this contract.
 *
 * Only supports EOA contract creations (tx.to === null). Tracing every single tx would've been quite expensive.
 *
 */
export async function findContractCreationTxByBinarySearch(
  sourcifyChain: SourcifyChain,
  contractAddress: string,
): Promise<string | null> {
  try {
    const currentBlockNumber = await sourcifyChain.getBlockNumber();
    let left = 0;
    let right = currentBlockNumber;

    logger.debug("Starting binary search for contract creation block", {
      chainId: sourcifyChain.chainId,
      contractAddress,
      currentBlockNumber,
    });

    let binarySearchCount = 0;

    // Binary search to find the first block where the contract exists
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const code = await sourcifyChain.getBytecode(contractAddress, mid);
      binarySearchCount++;

      // If no code at mid, contract was created after this block
      if (code === "0x") {
        left = mid + 1;
      }
      // If code exists at mid, contract was created at or before this block
      else {
        right = mid;
      }
    }

    // left is now the first block where the contract exists (creation block)
    const creationBlock = left;

    logger.debug("Found contract creation block", {
      chainId: sourcifyChain.chainId,
      contractAddress,
      creationBlock,
      binarySearchCount,
    });

    // Get all transactions in the creation block
    const block = await sourcifyChain.getBlock(creationBlock, true);
    if (!block || !block.prefetchedTransactions) {
      logger.warn("Block empty or not found during binary search", {
        chainId: sourcifyChain.chainId,
        contractAddress,
        creationBlock,
        binarySearchCount,
      });
      return null;
    }

    // Check each transaction in the block to find the creation transaction
    for (const tx of block.prefetchedTransactions) {
      // Skip if not a contract creation transaction
      if (tx.to !== null) continue;

      logger.debug("Found tx with tx.to===null", {
        contractAddress,
        chainId: sourcifyChain.chainId,
        txHash: tx.hash,
        block: block.number,
      });

      try {
        const receipt = await sourcifyChain.getTxReceipt(tx.hash);

        // Check if this transaction created our contract
        if (
          receipt.contractAddress?.toLowerCase() ===
          contractAddress.toLowerCase()
        ) {
          logger.info(
            "Found contract creation transaction using binary search",
            {
              contractAddress,
              creationBlock,
              transactionHash: tx.hash,
              chainId: sourcifyChain.chainId,
            },
          );
          return tx.hash;
        }
      } catch (error) {
        continue; // Skip if we can't get receipt
      }
    }
    logger.info("Could not find creation transaction with binary search", {
      contractAddress,
      creationBlock,
      binarySearchCount,
      chainId: sourcifyChain.chainId,
    });
    return null;
  } catch (error: any) {
    logger.warn("Error in binary search for contract creation", {
      contractAddress,
      error: error.message,
    });
    return null;
  }
}

export async function findContractCreationTxByBinarySearchWithTimeout(
  sourcifyChain: SourcifyChain,
  contractAddress: string,
  binarySearchTimeoutMs = BINARY_SEARCH_TIMEOUT_MS,
): Promise<string | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.warn(
        `Binary search for contract creation tx timed out after ${binarySearchTimeoutMs} ms`,
        {
          chainId: sourcifyChain.chainId,
          contractAddress,
          timeoutMs: binarySearchTimeoutMs,
        },
      );
      resolve(null);
    }, binarySearchTimeoutMs);
  });

  try {
    return await Promise.race([
      findContractCreationTxByBinarySearch(sourcifyChain, contractAddress),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
