import {
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

export const fetchFromEtherscan = async (
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

    // Derive API key precedence: user -> chain-specific env -> global -> ''
    const apiKey =
      userApiKey ||
      process.env[sourcifyChain.etherscanApi.apiKeyEnvName || ""] ||
      process.env.ETHERSCAN_API_KEY ||
      "";

    return await EtherscanUtils.fetchFromEtherscan(
      sourcifyChain.chainId,
      address,
      apiKey,
    );
  } catch (err) {
    return mapLibError(err, throwV2Errors);
  }
};

export async function getCompilationFromEtherscanResult(
  etherscanResult: any,
  solc: ISolidityCompiler,
  vyperCompiler: IVyperCompiler,
  throwV2Errors = false,
) {
  try {
    return EtherscanUtils.getCompilationFromEtherscanResult(
      etherscanResult,
      solc,
      vyperCompiler,
    );
  } catch (err) {
    return mapLibError(err, throwV2Errors);
  }
}
