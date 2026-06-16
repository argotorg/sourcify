import type {
  ISolidityCompiler,
  IVyperCompiler,
  SourcifyChain,
} from "@ethereum-sourcify/lib-sourcify";
import { BadRequestError, NotFoundError } from "../../../common/errors";
import { TooManyRequests } from "../../../common/errors/TooManyRequests";
import { BadGatewayError } from "../../../common/errors/BadGatewayError";
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

function mapLibError(err: any, throwV2Errors: boolean): never {
  const message = err?.message || "Etherscan import error";

  if (err instanceof EtherscanImportError) {
    switch (err.code) {
      case "etherscan_rate_limit":
        throw throwV2Errors
          ? new EtherscanLimitError(message)
          : new TooManyRequests(message);

      case "etherscan_not_verified":
        throw throwV2Errors
          ? new NotEtherscanVerifiedError(message)
          : new NotFoundError(message);

      case "etherscan_network_error":
      case "etherscan_http_error":
      case "etherscan_api_error":
        throw throwV2Errors
          ? new EtherscanRequestFailedError(message)
          : new BadGatewayError(message);

      case "etherscan_vyper_version_mapping_failed":
      case "etherscan_missing_contract_in_json":
      case "etherscan_missing_vyper_settings":
        throw throwV2Errors
          ? new MalformedEtherscanResponseError(message)
          : new BadRequestError(message);

      default:
        // Fallback for any new error codes not yet handled
        throw throwV2Errors
          ? new EtherscanRequestFailedError(message)
          : new BadGatewayError(message);
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

// Fetches contract data from Etherscan and maps any errors to appropriate server errors (v1 or v2)
export const fetchFromEtherscanOrThrowError = async (
  sourcifyChain: SourcifyChain,
  address: string,
  userApiKey?: string,
  throwV2Errors = false,
) => {
  try {
    // Enforce server-side support check previously done in lib
    if (!sourcifyChain.etherscanApi?.supported) {
      const errorMessage = `Requested chain ${sourcifyChain.chainId} is not supported for importing from Etherscan.`;
      throw throwV2Errors
        ? new ChainNotFoundError(errorMessage)
        : new BadRequestError(errorMessage);
    }

    const apiKey = deriveEtherscanApiKey(sourcifyChain, userApiKey);

    return await EtherscanUtils.fetchFromEtherscan(
      sourcifyChain.chainId,
      address,
      apiKey,
      sourcifyChain.etherscanApi?.url,
    );
  } catch (err) {
    return mapLibError(err, throwV2Errors);
  }
};

// Fetches compilation from Etherscan result and maps any errors to appropriate v1 server errors
export async function getCompilationFromEtherscanResultOrThrowV1Error(
  etherscanResult: any,
  solc: ISolidityCompiler,
  vyperCompiler: IVyperCompiler,
) {
  try {
    return EtherscanUtils.getCompilationFromEtherscanResult(
      etherscanResult,
      solc,
      vyperCompiler,
    );
  } catch (err) {
    return mapLibError(err, false);
  }
}
