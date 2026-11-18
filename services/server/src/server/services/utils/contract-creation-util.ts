import type { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import { StatusCodes } from "http-status-codes";
import logger from "../../../common/logger";
import { deriveEtherscanApiKey } from "./etherscan-util";

const ETHERSCAN_API =
  "https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}&module=contract&action=getcontractcreation&contractaddresses=${ADDRESS}&apikey=";
const BLOCKSCOUT_API_SUFFIX = "/api/v2/addresses/${ADDRESS}";
const BLOCKSCOUT_PRO_API_URL =
  "https://api.blockscout.com/${CHAIN_ID}/api/v2/addresses/${ADDRESS}?apikey=";
const AVALANCHE_SUBNET_SUFFIX =
  "contracts/${ADDRESS}/transactions:getDeployment";
const NEXUS_SUFFIX = "v1/${RUNTIME}/accounts/${ADDRESS}";
const ROUTESCAN_API_URL =
  "https://api.routescan.io/v2/network/${CHAIN_TYPE}/evm/${CHAIN_ID}/etherscan/api?module=contract&action=getcontractcreation&contractaddresses=${ADDRESS}";
const VECHAIN_API_URL =
  "https://api.vechainstats.com/v2/contract/info?address=${ADDRESS}&expanded=true&VCS_API_KEY=";

export const BINARY_SEARCH_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
export const HYPERSYNC_REQUEST_TIMEOUT_MS = 15 * 1000;
// Limit for all requests of one lookup
export const HYPERSYNC_LOOKUP_TIMEOUT_MS = 30 * 1000;

interface ContractCreationFetcher {
  type: "api";
  url: string;
  maskedUrl?: string;
  responseParser?: (response: any) => any;
}

function getApiContractCreationFetcher(
  url: string,
  responseParser: (response: any) => any,
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
  customBaseUrl?: string,
): ContractCreationFetcher {
  const baseUrl = customBaseUrl
    ? `${customBaseUrl}/api?module=contract&action=getcontractcreation&contractaddresses=\${ADDRESS}&apikey=`
    : ETHERSCAN_API.replace("${CHAIN_ID}", chainId.toString());
  return getApiContractCreationFetcher(
    baseUrl + apiKey,
    (response: any) => {
      if (response?.message === "NOTOK")
        throw new Error(`Etherscan API error: ${response?.result}`);
      if (response?.result?.[0]?.txHash)
        return response?.result?.[0]?.txHash as string;
    },
    baseUrl,
  );
}

function parseBlockscoutCreationTx(response: any) {
  return response?.creation_tx_hash || response?.creation_transaction_hash;
}

function getBlockscoutApiContractCreatorFetcher(
  apiURL: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    apiURL + BLOCKSCOUT_API_SUFFIX,
    parseBlockscoutCreationTx,
  );
}

function getBlockscoutProApiContractCreatorFetcher(
  chainId: number,
  apiKey: string,
): ContractCreationFetcher {
  // Don't replace ${ADDRESS} because it's done inside getCreatorTxUsingFetcher()
  const url = BLOCKSCOUT_PRO_API_URL.replace("${CHAIN_ID}", chainId.toString());
  return getApiContractCreationFetcher(
    url + apiKey,
    parseBlockscoutCreationTx,
    url,
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

type HyperSyncTable = "transactions" | "traces";

/**
 * Runs a HyperSync query from the first block to the chain head.
 * One request scans a limited block range, so the function requests the next range until the scan is complete.
 * Returns the rows of the given table.
 */
async function queryHyperSync(
  url: string,
  token: string,
  query: Record<string, unknown>,
  table: HyperSyncTable,
  deadline: number,
  isComplete?: (rows: any[]) => boolean,
): Promise<any[]> {
  const endpoint = `${url.replace(/\/+$/, "")}/query`;
  const rows: any[] = [];
  const startTime = Date.now();
  let requestCount = 0;
  let fromBlock = 0;
  const logFinished = () =>
    logger.debug("HyperSync query finished", {
      endpoint,
      table,
      requestCount,
      durationMs: Date.now() - startTime,
    });
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `HyperSync lookup timed out after ${HYPERSYNC_LOOKUP_TIMEOUT_MS} ms and ${requestCount} requests on the ${table} query`,
      );
    }
    requestCount++;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...query, from_block: fromBlock }),
      signal: AbortSignal.timeout(
        Math.min(HYPERSYNC_REQUEST_TIMEOUT_MS, remainingMs),
      ),
    });
    if (res.status !== StatusCodes.OK) {
      throw new Error(`HyperSync API returned status ${res.status}`);
    }
    const response = await res.json();
    const nextBlock = response?.next_block;
    const archiveHeight = response?.archive_height;
    if (
      !Array.isArray(response?.data) ||
      typeof nextBlock !== "number" ||
      typeof archiveHeight !== "number"
    ) {
      throw new Error("HyperSync API returned an unexpected response");
    }
    for (const chunk of response.data) {
      if (Array.isArray(chunk?.[table])) {
        rows.push(...chunk[table]);
      }
    }
    if (isComplete?.(rows) || nextBlock > archiveHeight) {
      logFinished();
      return rows;
    }
    // An incomplete scan must not count as a miss.
    if (nextBlock <= fromBlock) {
      throw new Error(
        `HyperSync API did not advance from block ${fromBlock} on the ${table} query`,
      );
    }
    fromBlock = nextBlock;
  }
}

// Receipts from before the Byzantium fork have no status.
function isFailedHyperSyncTx(tx: any): boolean {
  return (
    tx?.status !== undefined && tx?.status !== null && Number(tx.status) === 0
  );
}

/**
 * Finds the creation transaction with Envio HyperSync.
 * The transaction query finds contracts that a transaction created directly.
 * The trace query finds contracts that a factory created. It needs the traces endpoint of the chain.
 */
async function getCreatorTxUsingHyperSync(
  hyperSyncApi: { url: string; tracesUrl?: string },
  contractAddress: string,
  token: string,
): Promise<string | null> {
  const address = contractAddress.toLowerCase();
  const deadline = Date.now() + HYPERSYNC_LOOKUP_TIMEOUT_MS;
  logger.debug("Fetching Creator Tx from HyperSync", {
    url: hyperSyncApi.url,
    tracesUrl: hyperSyncApi.tracesUrl,
    contractAddress,
  });

  const findCreationTx = (transactions: any[]) =>
    transactions.find((tx) => tx?.hash && !isFailedHyperSyncTx(tx));
  const transactions = await queryHyperSync(
    hyperSyncApi.url,
    token,
    {
      transactions: [{ contract_address: [address] }],
      field_selection: { transaction: ["hash", "status", "block_number"] },
      join_mode: "JoinNothing",
    },
    "transactions",
    deadline,
    (rows) => findCreationTx(rows) !== undefined,
  );
  const creationTx = findCreationTx(transactions);
  if (creationTx) {
    return creationTx.hash as string;
  }

  if (!hyperSyncApi.tracesUrl) {
    logger.debug("HyperSync returned no creation tx", { contractAddress });
    return null;
  }

  const traces = await queryHyperSync(
    hyperSyncApi.tracesUrl,
    token,
    {
      traces: [{ type: ["create"], address: [address] }],
      field_selection: {
        trace: [
          "transaction_hash",
          "block_number",
          "transaction_position",
          "error",
        ],
      },
      join_mode: "JoinNothing",
    },
    "traces",
    deadline,
  );
  // A create on an address with code fails with an error.
  // Thus the last create without an error deployed the current code.
  let creationTrace: any;
  for (const trace of traces) {
    if (!trace?.transaction_hash || trace.error) continue;
    if (
      !creationTrace ||
      trace.block_number > creationTrace.block_number ||
      (trace.block_number === creationTrace.block_number &&
        trace.transaction_position >= creationTrace.transaction_position)
    ) {
      creationTrace = trace;
    }
  }
  if (creationTrace) {
    return creationTrace.transaction_hash as string;
  }
  logger.debug("HyperSync returned no creation tx", { contractAddress });
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
  // The url can contain an API key. Only log the masked url.
  const maskedFetchAddressFilled = fetcher?.maskedUrl?.replace(
    "${ADDRESS}",
    contractAddress,
  );

  logger.debug("Fetching Creator Tx", {
    fetcherUrl: fetcher?.maskedUrl,
    maskedFetchAddressFilled,
    contractAddress,
  });

  if (!contractFetchAddressFilled) return null;

  try {
    if (fetcher?.responseParser) {
      const response = await fetchFromApi(
        contractFetchAddressFilled,
        maskedFetchAddressFilled,
      );
      const creatorTx = fetcher?.responseParser(response);
      if (creatorTx) {
        logger.debug("Fetched Creator Tx", {
          fetcherUrl: fetcher?.maskedUrl,
          maskedFetchAddressFilled,
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
  // Try HyperSync first
  const envioApiToken = process.env.ENVIO_API_TOKEN;
  if (
    sourcifyChain.fetchContractCreationTxUsing?.hyperSyncApi &&
    envioApiToken
  ) {
    try {
      const result = await getCreatorTxUsingHyperSync(
        sourcifyChain.fetchContractCreationTxUsing.hyperSyncApi,
        contractAddress,
        envioApiToken,
      );
      if (result) {
        logger.debug("Fetched Creator Tx from HyperSync", {
          contractAddress,
          creatorTx: result,
        });
        return result;
      }
    } catch (e: any) {
      // The fetch error of an invalid header value contains the token.
      logger.warn("Error fetching creation tx from HyperSync", {
        chainId: sourcifyChain.chainId,
        contractAddress,
        error: String(e?.message).split(envioApiToken).join("****"),
      });
    }
  }

  // Try blockscout if HyperSync fails
  if (sourcifyChain.fetchContractCreationTxUsing?.blockscoutApi) {
    const { url, proApi } =
      sourcifyChain.fetchContractCreationTxUsing.blockscoutApi;
    // Use the PRO API gateway for the higher rate limits when the chain supports it
    const proApiKey = process.env.BLOCKSCOUT_PRO_API_KEY;
    const fetcher =
      proApi && proApiKey
        ? getBlockscoutProApiContractCreatorFetcher(
            sourcifyChain.chainId,
            proApiKey,
          )
        : getBlockscoutApiContractCreatorFetcher(url);
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
    const apiKey = deriveEtherscanApiKey(sourcifyChain);
    const fetcher = getEtherscanApiContractCreatorFetcher(
      apiKey,
      sourcifyChain.chainId,
      sourcifyChain.etherscanApi?.url,
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

// The error message goes into the logs. It must not contain the API key.
async function fetchFromApi(fetchAddress: string, maskedFetchAddress?: string) {
  const res = await fetch(fetchAddress);
  if (res.status === StatusCodes.OK) {
    const response = await res.json();
    return response;
  }

  throw new Error(
    `Contract creator tx could not be fetched from ${maskedFetchAddress} because of status code ${res.status}`,
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
