import { ContractCreationFetcher} from "@ethereum-sourcify/lib-sourcify";
import { StatusCodes } from "http-status-codes";
import { Chain } from "../chain/Chain";
import {format} from "js-conflux-sdk";

const ETHERSCAN_REGEX = ["at txn.*href=.*/tx/(0x.{64})"]; // save as string to be able to return the txRegex in /chains response. If stored as RegExp returns {}
const ETHERSCAN_SUFFIX = "address/${ADDRESS}";
const BLOCKSCOUT_REGEX_OLD = 'transaction_hash_link" href="${BLOCKSCOUT_PREFIX}/tx/(.*?)"';
const BLOCKSCOUT_REGEX_NEW = "at txn.*href.*/tx/(0x.{64}?)";
const BLOCKSCOUT_SUFFIX = "address/${ADDRESS}/transactions";
const ETHERSCAN_API_SUFFIX = `/api?module=contract&action=getcontractcreation&contractaddresses=\${ADDRESS}&apikey=`;
const BLOCKSSCAN_SUFFIX = "api/accounts/${ADDRESS}";
const BLOCKSCOUT_API_SUFFIX = "/api/v2/addresses/${ADDRESS}";
const TELOS_SUFFIX = "v1/contract/${ADDRESS}";
const METER_SUFFIX = "api/accounts/${ADDRESS}";
const AVALANCHE_SUBNET_SUFFIX = "contracts/${ADDRESS}/transactions:getDeployment";
const NEXUS_SUFFIX = "v1/${RUNTIME}/accounts/${ADDRESS}";
const ROUTESCAN_API_URL = "https://api.routescan.io/v2/network/${CHAIN_TYPE}/evm/${CHAIN_ID}/etherscan?module=contract&action=getcontractcreation&contractaddresses=${ADDRESS}";

function getApiContractCreationFetcher(
  url: string,
  responseParser: Function,
): ContractCreationFetcher {
  return {
    type: "api",
    url,
    responseParser,
  };
}

function getScrapeContractCreationFetcher(
  url: string,
  scrapeRegex: string[],
): ContractCreationFetcher {
  return {
    type: "scrape",
    url,
    scrapeRegex,
  };
}

function getEtherscanScrapeContractCreatorFetcher(
  apiURL: string,
): ContractCreationFetcher {
  return getScrapeContractCreationFetcher(
    apiURL + ETHERSCAN_SUFFIX,
    ETHERSCAN_REGEX,
  );
}

function getBlockscoutRegex(blockscoutPrefix = "") {
  const tempBlockscoutOld = BLOCKSCOUT_REGEX_OLD.replace(
    "${BLOCKSCOUT_PREFIX}",
    blockscoutPrefix,
  );
  return [tempBlockscoutOld, BLOCKSCOUT_REGEX_NEW];
}

function getBlockscoutScrapeContractCreatorFetcher(
  apiURL: string,
  blockscoutPrefix = "",
): ContractCreationFetcher {
  return getScrapeContractCreationFetcher(
    apiURL + BLOCKSCOUT_SUFFIX,
    getBlockscoutRegex(blockscoutPrefix),
  );
}

// api?module=contract&action=getcontractcreation&contractaddresses=\${ADDRESS}&apikey=
// For chains with the new Etherscan api that has contract creator tx hash endpoint
function getEtherscanApiContractCreatorFetcher(
  apiURL: string,
  apiKey: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    apiURL + ETHERSCAN_API_SUFFIX + apiKey,
    (response: any) => {
      if (response?.result?.[0]?.txHash)
        return response?.result?.[0]?.txHash as string;
    },
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

function getMeterApiContractCreatorFetcher(
  apiURL: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    apiURL + METER_SUFFIX,
    (response: any) => {
      return response.account.creationTxHash as string;
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

  console.debug("Fetching Creator Tx", {
    fetcher,
    contractFetchAddressFilled,
    contractAddress,
  });

  if (!contractFetchAddressFilled) return null;

  try {
    switch (fetcher.type) {
      case "scrape": {
        if (fetcher?.scrapeRegex) {
          const creatorTx = await getCreatorTxByScraping(
            contractFetchAddressFilled,
            fetcher?.scrapeRegex,
          );
          if (creatorTx) {
            console.debug("Fetched and found creator Tx", {
              fetcher,
              contractFetchAddressFilled,
              contractAddress,
              creatorTx,
            });
            return creatorTx;
          }
        }
        break;
      }
      case "api": {
        if (fetcher?.responseParser) {
          const response = await fetchFromApi(contractFetchAddressFilled);
          const creatorTx = fetcher?.responseParser(response);
          console.debug("Fetched Creator Tx", {
            fetcher,
            contractFetchAddressFilled,
            contractAddress,
            creatorTx,
          });
          if (creatorTx) {
            return creatorTx;
          }
        }
        break;
      }
    }
  } catch (e: any) {
    console.warn("Error while getting creation transaction", {
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
  chain: Chain,
  contractAddress: string,
): Promise<string | null> => {
  // Try blockscout first
  if (chain.fetchContractCreationTxUsing?.blockscoutApi) {
    const fetcher = getBlockscoutApiContractCreatorFetcher(
      chain.fetchContractCreationTxUsing?.blockscoutApi.url,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  // Try routescan if blockscout fails
  if (chain.fetchContractCreationTxUsing?.routescanApi) {
    const fetcher = getRoutescanApiContractCreatorFetcher(
      chain.fetchContractCreationTxUsing?.routescanApi.type,
      chain.chainId,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  // Try etherscan if routescan fails
  if (
    chain.fetchContractCreationTxUsing?.etherscanApi &&
    chain?.etherscanApi?.apiURL
  ) {
    const apiKey = process.env[chain.etherscanApi.apiKeyEnvName || ""];
    const fetcher = getEtherscanApiContractCreatorFetcher(
      chain.etherscanApi.apiURL,
      apiKey || "",
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }
  if (chain.fetchContractCreationTxUsing?.avalancheApi) {
    const fetcher = getAvalancheApiContractCreatorFetcher(
      chain.chainId.toString(),
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  if (chain.fetchContractCreationTxUsing?.blockscoutScrape) {
    const fetcher = getBlockscoutScrapeContractCreatorFetcher(
      chain.fetchContractCreationTxUsing?.blockscoutScrape.url,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }
  if (chain.fetchContractCreationTxUsing?.blocksScanApi) {
    const fetcher = getBlocksScanApiContractCreatorFetcher(
      chain.fetchContractCreationTxUsing?.blocksScanApi.url,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }
  if (chain.fetchContractCreationTxUsing?.meterApi) {
    const fetcher = getMeterApiContractCreatorFetcher(
      chain.fetchContractCreationTxUsing?.meterApi.url,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }
  if (chain.fetchContractCreationTxUsing?.telosApi) {
    const fetcher = getTelosApiContractCreatorFetcher(
      chain.fetchContractCreationTxUsing?.telosApi.url,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }
  if (chain.fetchContractCreationTxUsing?.etherscanScrape) {
    const fetcher = getEtherscanScrapeContractCreatorFetcher(
      chain.fetchContractCreationTxUsing?.etherscanScrape.url,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }
  if (chain.fetchContractCreationTxUsing?.nexusApi) {
    const fetcher = getNexusApiContractCreatorFetcher(
      chain.fetchContractCreationTxUsing?.nexusApi.url,
      chain.fetchContractCreationTxUsing?.nexusApi.runtime,
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  // Try binary search as last resort
  console.debug("Trying binary search to find contract creation transaction", {
    contractAddress,
  });
  const result = await findContractCreationTxByBinarySearch(
    chain,
    contractAddress,
  );
  if (result) {
    return result;
  }

  console.warn("Couldn't fetch creator tx", {
    chainId: chain.chainId,
    contractAddress,
  });

  return null;
};

/**
 * Fetches the block explorer page (Etherscan, Blockscout etc.) of the contract and extracts the transaction hash that created the contract from the page with the provided regex for that explorer.
 *
 * @param fetchAddress the URL from which to fetch the page to be scrapd
 * @param txRegex regex whose first group matches the transaction hash on the page
 * @returns a promise of the tx hash that created the contract
 */
async function getCreatorTxByScraping(
  fetchAddress: string,
  txRegexs: string[],
): Promise<string | null> {
  const res = await fetch(fetchAddress);
  const arrayBuffer = await res.arrayBuffer();
  const page = Buffer.from(arrayBuffer).toString();
  if (res.status === StatusCodes.OK) {
    for (const txRegex of txRegexs) {
      const matched = page.match(txRegex);
      if (matched && matched[1]) {
        const txHash = matched[1];
        return txHash;
      } else {
        if (page.includes("captcha") || page.includes("CAPTCHA")) {
          console.warn("Scraping the creator tx failed because of CAPTCHA", {
            fetchAddress,
          });
          throw new Error(
            `Scraping the creator tx failed because of CAPTCHA at ${fetchAddress}`,
          );
        }
      }
    }
  }
  if (res.status === StatusCodes.FORBIDDEN) {
    console.warn("Scraping the creator tx failed", {
      fetchAddress,
      status: res.status,
    });
    throw new Error(
      `Scraping the creator tx failed at ${fetchAddress} because of HTTP status code ${res.status} (Forbidden)
      
      Try manually putting the creator tx hash in the "Creator tx hash" field.`,
    );
  }

  console.debug("Could not find creator tx via scraping", {
    fetchAddress,
    status: res.status,
  });
  return null;
}

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
  chain: Chain,
  contractAddress: string,
): Promise<string | null> {
  try {
    const currentBlockNumber = await chain.getBlockNumber();
    let left = 0;
    let right = currentBlockNumber;

    console.debug("Starting binary search for contract creation block", {
      chainId: chain.chainId,
      contractAddress,
      currentBlockNumber,
    });

    let binarySearchCount = 0;

    // Binary search to find the first block where the contract exists
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const code = await chain.getBytecode(contractAddress, mid);
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

    console.debug("Found contract creation block", {
      chainId: chain.chainId,
      contractAddress,
      creationBlock,
      binarySearchCount,
    });

    // Get all transactions in the creation block
    const block = await chain.getBlock(creationBlock, true);
    if (!block || !block.prefetchedTransactions) {
      console.warn("Block empty or not found during binary search", {
        chainId: chain.chainId,
        contractAddress,
        creationBlock,
        binarySearchCount,
      });
      return null;
    }

    // Check each transaction in the block to find the creation transaction
    const normalizedAddress = format.hexAddress(contractAddress)
    for (const tx of block.prefetchedTransactions) {
      // Skip if not a contract creation transaction
      if (tx.to !== null) continue;

      console.debug("Found tx with tx.to===null", {
        contractAddress,
        chainId: chain.chainId,
        txHash: tx.hash,
        block: block.number,
      });

      try {
        const receipt = await chain.getTxReceipt(tx.hash);

        // Check if this transaction created our contract
        if (receipt?.contractAddress && (format.hexAddress(receipt.contractAddress) === normalizedAddress)) {
          console.info(
            "Found contract creation transaction using binary search",
            {
              contractAddress,
              creationBlock,
              transactionHash: tx.hash,
              chainId: chain.chainId,
            },
          );
          return tx.hash;
        }
      } catch (error) {
        continue; // Skip if we can't get receipt
      }
    }
    console.info("Could not find creation transaction with binary search", {
      contractAddress,
      creationBlock,
      binarySearchCount,
      chainId: chain.chainId,
    });
    return null;
  } catch (error: any) {
    console.warn("Error in binary search for contract creation", {
      contractAddress,
      error: error.message,
    });
    return null;
  }
}
