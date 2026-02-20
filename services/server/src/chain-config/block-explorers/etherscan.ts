export interface EtherscanChainData {
  apiUrl: string;
  chainName: string;
  blockExplorerUrl: string;
}

interface EtherscanChainEntry {
  chainname: string;
  chainid: string;
  blockexplorer: string;
  apiurl: string;
  status: number;
}

interface EtherscanResponse {
  totalcount: number;
  result: EtherscanChainEntry[];
}

const ETHERSCAN_CHAINLIST_URL = "https://api.etherscan.io/v2/chainlist";

/**
 * Fetches the list of chains supported by Etherscan's unified v2 API.
 * Filters to only active chains (status === 1).
 */
export async function fetchEtherscanChains(): Promise<
  Map<number, EtherscanChainData>
> {
  const response = await fetch(ETHERSCAN_CHAINLIST_URL);

  if (!response.ok) {
    throw new Error(
      `Etherscan chainlist returned ${response.status}: ${await response.text()}`,
    );
  }

  const data = (await response.json()) as EtherscanResponse;
  const result = new Map<number, EtherscanChainData>();

  for (const entry of data.result) {
    // Only include active chains
    if (entry.status !== 1) {
      continue;
    }

    const chainId = parseInt(entry.chainid, 10);
    if (isNaN(chainId)) {
      continue;
    }

    result.set(chainId, {
      apiUrl: entry.apiurl,
      chainName: entry.chainname,
      blockExplorerUrl: entry.blockexplorer,
    });
  }

  return result;
}
