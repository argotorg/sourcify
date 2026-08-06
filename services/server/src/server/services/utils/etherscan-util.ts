import type { SourcifyChain } from "@ethereum-sourcify/lib-sourcify";
import {
  ChainNotFoundError,
  EtherscanLimitError,
  EtherscanRequestFailedError,
  MalformedEtherscanResponseError,
  NotEtherscanVerifiedError,
} from "../../apiv2/errors";
import {
  EtherscanUtils,
  EtherscanImportError,
} from "@ethereum-sourcify/lib-sourcify";

function mapLibError(err: any): never {
  const message = err?.message || "Etherscan import error";

  if (err instanceof EtherscanImportError) {
    switch (err.code) {
      case "etherscan_rate_limit":
        throw new EtherscanLimitError(message);

      case "etherscan_not_verified":
        throw new NotEtherscanVerifiedError(message);

      case "etherscan_network_error":
      case "etherscan_http_error":
      case "etherscan_api_error":
        throw new EtherscanRequestFailedError(message);

      case "etherscan_vyper_version_mapping_failed":
      case "etherscan_missing_contract_in_json":
      case "etherscan_missing_vyper_settings":
        throw new MalformedEtherscanResponseError(message);

      default:
        // Fallback for any new error codes not yet handled
        throw new EtherscanRequestFailedError(message);
    }
  }

  // Unknown error from lib
  throw err;
}

// Derive the Etherscan API key with precedence: user -> chain-specific env -> global -> ''.
// The global ETHERSCAN_API_KEY is only used for canonical etherscan.io chains. For custom
// Etherscan-compatible explorers (those with a `url`), we never fall back to it — that would
// leak our etherscan.io key to a third-party server. Such explorers only get a key explicitly
// configured for them via their own apiKeyEnvName.
export const deriveEtherscanApiKey = (
  sourcifyChain: SourcifyChain,
  userApiKey?: string,
): string => {
  const chainSpecificKey =
    process.env[sourcifyChain.etherscanApi?.apiKeyEnvName || ""];
  const globalKey = sourcifyChain.etherscanApi?.url
    ? undefined
    : process.env.ETHERSCAN_API_KEY;
  return userApiKey || chainSpecificKey || globalKey || "";
};

// Fetches contract data from Etherscan and maps any errors to appropriate server errors
export const fetchFromEtherscanOrThrowError = async (
  sourcifyChain: SourcifyChain,
  address: string,
  userApiKey?: string,
) => {
  try {
    // Enforce server-side support check previously done in lib
    if (!sourcifyChain.etherscanApi?.supported) {
      throw new ChainNotFoundError(
        `Requested chain ${sourcifyChain.chainId} is not supported for importing from Etherscan.`,
      );
    }

    const apiKey = deriveEtherscanApiKey(sourcifyChain, userApiKey);

    return await EtherscanUtils.fetchFromEtherscan(
      sourcifyChain.chainId,
      address,
      apiKey,
      sourcifyChain.etherscanApi?.url,
    );
  } catch (err) {
    return mapLibError(err);
  }
};
