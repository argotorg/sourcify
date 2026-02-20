export interface QuickNodeChainData {
  networkSlug: string;
  name: string;
}

interface QuickNodeNetwork {
  slug: string;
  name: string;
  chain_id: number | null;
}

interface QuickNodeChainGroup {
  slug: string;
  networks: QuickNodeNetwork[];
}

interface QuickNodeResponse {
  data: QuickNodeChainGroup[];
  error: string | null;
}

function parseQuickNodeResponse(
  data: QuickNodeResponse,
): Map<number, QuickNodeChainData> {
  const result = new Map<number, QuickNodeChainData>();
  for (const chainGroup of data.data) {
    for (const network of chainGroup.networks) {
      // Only include EVM chains (chain_id !== null)
      if (network.chain_id !== null) {
        result.set(network.chain_id, {
          networkSlug: network.slug,
          name: network.name,
        });
      }
    }
  }
  return result;
}

/**
 * Parses a locally cached QuickNode API response from a JSON file.
 */
export async function loadQuickNodeChainsFromFile(
  filePath: string,
): Promise<Map<number, QuickNodeChainData>> {
  const fs = await import("fs");
  const data = JSON.parse(
    fs.readFileSync(filePath, "utf8"),
  ) as QuickNodeResponse;
  if (data.error) {
    throw new Error(`QuickNode data error: ${data.error}`);
  }
  return parseQuickNodeResponse(data);
}

/**
 * Fetches the list of EVM chains supported by QuickNode.
 * Requires a Console API key (different from an RPC endpoint token).
 * RPC URL template: https://{SUBDOMAIN}.{networkSlug}.quiknode.pro/{API_KEY}
 */
export async function fetchQuickNodeChains(
  consoleApiKey: string,
): Promise<Map<number, QuickNodeChainData>> {
  const response = await fetch("https://api.quicknode.com/v0/chains", {
    headers: {
      "x-api-key": consoleApiKey,
    },
  });

  if (!response.ok) {
    throw new Error(
      `QuickNode API returned ${response.status}: ${await response.text()}`,
    );
  }

  const data = (await response.json()) as QuickNodeResponse;
  if (data.error) {
    throw new Error(`QuickNode API error: ${data.error}`);
  }

  return parseQuickNodeResponse(data);
}
