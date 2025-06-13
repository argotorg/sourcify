import { ContractCreationFetcher} from "@ethereum-sourcify/lib-sourcify";
import { StatusCodes } from "http-status-codes";
import { Chain } from "../chain/Chain";
import { format } from "js-conflux-sdk";

const CONFLUXSCAN_REGEX = ["at txn.*href=.*/tx/(0x.{64})"]; // save as string to be able to return the txRegex in /chains response. If stored as RegExp returns {}
const CONFLUXSCAN_SUFFIX = "address/${ADDRESS}";
const CONFLUXSCAN_API_SUFFIX = `/api?module=contract&action=getcontractcreation&contractaddresses=\${ADDRESS}&apikey=`;

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

function getConfluxscanScrapeContractCreatorFetcher(
  apiURL: string,
): ContractCreationFetcher {
  return getScrapeContractCreationFetcher(
    apiURL + CONFLUXSCAN_SUFFIX,
    CONFLUXSCAN_REGEX,
  );
}

// api?module=contract&action=getcontractcreation&contractaddresses=\${ADDRESS}&apikey=
// For chains with the new Confluxscan api that has contract creator tx hash endpoint
function getConfluxscanApiContractCreatorFetcher(
  apiURL: string,
  apiKey: string,
): ContractCreationFetcher {
  return getApiContractCreationFetcher(
    apiURL + CONFLUXSCAN_API_SUFFIX + apiKey,
    (response: any) => {
      if (response?.result?.[0]?.txHash)
        return response?.result?.[0]?.txHash as string;
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
 * Fetches the block explorer page (Confluxscan etc.) of the contract and extracts the transaction hash that created the contract from the page with the provided regex for that explorer.
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
  // Try confluxscan api first
  if (
    chain.fetchContractCreationTxUsing?.confluxscanApi &&
    chain?.confluxscanApi?.apiURL
  ) {
    const apiKey = process.env[chain.confluxscanApi.apiKeyEnvName || ""];
    const fetcher = getConfluxscanApiContractCreatorFetcher(
      chain.confluxscanApi.apiURL,
      apiKey || "",
    );
    const result = await getCreatorTxUsingFetcher(fetcher, contractAddress);
    if (result) {
      return result;
    }
  }

  // Try confluxscan scrape after confluxscan api fail
  if (chain.fetchContractCreationTxUsing?.confluxscanScrape) {
    const fetcher = getConfluxscanScrapeContractCreatorFetcher(
      chain.fetchContractCreationTxUsing?.confluxscanScrape.url,
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
