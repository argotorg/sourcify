import YAML from "yamljs";

export interface DrpcChainData {
  shortName: string;
}

interface DrpcChainEntry {
  id: string;
  "chain-id": string | number;
  "short-names": string[];
}

interface DrpcProtocol {
  id: string;
  type: string;
  chains: DrpcChainEntry[];
}

interface DrpcConfig {
  "chain-settings": {
    protocols: DrpcProtocol[];
  };
}

const DRPC_CHAINS_URL =
  "https://raw.githubusercontent.com/drpcorg/public/refs/heads/main/chains.yaml";

/**
 * Fetches the list of EVM chains supported by dRPC.
 * RPC URL: https://lb.drpc.org/ogrpc?network={shortName}&dkey={API_KEY}
 */
export async function fetchDrpcChains(): Promise<Map<number, DrpcChainData>> {
  const response = await fetch(DRPC_CHAINS_URL);

  if (!response.ok) {
    throw new Error(
      `dRPC chains YAML returned ${response.status}: ${await response.text()}`,
    );
  }

  const yamlText = await response.text();
  const config = YAML.parse(yamlText) as DrpcConfig;

  const result = new Map<number, DrpcChainData>();

  for (const protocol of config["chain-settings"].protocols) {
    // Only include EVM chains (type: eth)
    if (protocol.type !== "eth") {
      continue;
    }

    for (const chain of protocol.chains) {
      const chainIdRaw = chain["chain-id"];
      let chainId: number;

      if (typeof chainIdRaw === "string" && chainIdRaw.startsWith("0x")) {
        chainId = parseInt(chainIdRaw, 16);
      } else if (typeof chainIdRaw === "number") {
        chainId = chainIdRaw;
      } else {
        // Skip entries with unparseable chain IDs
        continue;
      }

      if (chainId === 0 || isNaN(chainId)) {
        continue;
      }

      // Use the first short-name as the primary identifier
      const shortName = chain["short-names"]?.[0];
      if (shortName) {
        result.set(chainId, { shortName });
      }
    }
  }

  return result;
}
