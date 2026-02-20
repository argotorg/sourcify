export interface BlockscoutChainData {
  url: string;
  hostedBy: string;
  name: string;
}

interface BlockscoutExplorer {
  url: string;
  hostedBy: string;
}

interface BlockscoutChainEntry {
  name: string;
  explorers: BlockscoutExplorer[];
}

type BlockscoutResponse = Record<string, BlockscoutChainEntry>;

const BLOCKSCOUT_CHAINS_URL = "https://chains.blockscout.com/api/chains";

/**
 * Fetches the list of chains with Blockscout explorers.
 * The response keys are chain IDs.
 */
export async function fetchBlockscoutChains(): Promise<
  Map<number, BlockscoutChainData>
> {
  const response = await fetch(BLOCKSCOUT_CHAINS_URL);

  if (!response.ok) {
    throw new Error(
      `Blockscout chains API returned ${response.status}: ${await response.text()}`,
    );
  }

  const data = (await response.json()) as BlockscoutResponse;
  const result = new Map<number, BlockscoutChainData>();

  for (const [chainIdStr, entry] of Object.entries(data)) {
    // Only accept purely numeric keys (some entries like "1__" have suffixes)
    if (!/^\d+$/.test(chainIdStr)) {
      continue;
    }
    const chainId = parseInt(chainIdStr, 10);

    // Use the first explorer URL
    const explorer = entry.explorers?.[0];
    if (explorer?.url) {
      result.set(chainId, {
        url: explorer.url,
        hostedBy: explorer.hostedBy,
        name: entry.name,
      });
    }
  }

  return result;
}
