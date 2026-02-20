export interface RoutescanChainData {
  workspace: string;
  name: string;
}

interface RoutescanExplorer {
  chainId: string;
  name: string;
  workspace: string;
}

interface RoutescanResponse {
  items: RoutescanExplorer[];
}

const ROUTESCAN_EXPLORERS_URL =
  "https://cdn.routescan.io/api/evm/all/explorers";

/**
 * Fetches the list of chains with Routescan explorers.
 * Filters out non-numeric chainIds (e.g. "all", "debug").
 */
export async function fetchRoutescanChains(): Promise<
  Map<number, RoutescanChainData>
> {
  const response = await fetch(ROUTESCAN_EXPLORERS_URL);

  if (!response.ok) {
    throw new Error(
      `Routescan API returned ${response.status}: ${await response.text()}`,
    );
  }

  const data = (await response.json()) as RoutescanResponse;
  const result = new Map<number, RoutescanChainData>();

  for (const explorer of data.items) {
    const chainId = parseInt(explorer.chainId, 10);
    if (isNaN(chainId)) {
      continue;
    }

    // Only keep the first entry per chain ID
    if (!result.has(chainId)) {
      result.set(chainId, {
        workspace: explorer.workspace,
        name: explorer.name,
      });
    }
  }

  return result;
}
