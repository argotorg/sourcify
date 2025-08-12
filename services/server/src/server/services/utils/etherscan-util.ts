import {
  ISolidityCompiler,
  IVyperCompiler,
  SolidityJsonInput,
  SourcifyChain,
  VyperJsonInput,
  VyperCompilation,
  SolidityCompilation,
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
  isVyperResult,
  EtherscanChainNotSupportedLibError,
  EtherscanRequestFailedLibError,
  EtherscanLimitLibError,
  NotEtherscanVerifiedLibError,
  MalformedEtherscanResponseLibError,
} from "@ethereum-sourcify/lib-sourcify";

import * as LibSourcify from "@ethereum-sourcify/lib-sourcify";

function mapLibError(err: any, throwV2Errors: boolean): never {
  const message = err?.message || "Etherscan import error";
  if (err instanceof EtherscanChainNotSupportedLibError) {
    throw throwV2Errors
      ? new ChainNotFoundError(message)
      : new BadRequestError(message);
  }
  if (err instanceof EtherscanRequestFailedLibError) {
    throw throwV2Errors
      ? new EtherscanRequestFailedError(message)
      : new BadGatewayError(message);
  }
  if (err instanceof EtherscanLimitLibError) {
    throw throwV2Errors
      ? new EtherscanLimitError(message)
      : new TooManyRequests(message);
  }
  if (err instanceof NotEtherscanVerifiedLibError) {
    throw throwV2Errors
      ? new NotEtherscanVerifiedError(message)
      : new NotFoundError(message);
  }
  if (err instanceof MalformedEtherscanResponseLibError) {
    throw throwV2Errors
      ? new MalformedEtherscanResponseError(message)
      : new BadRequestError(message);
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
      throw new EtherscanChainNotSupportedLibError(errorMessage);
    }

    // Derive API key precedence: user -> chain-specific env -> global -> ''
    const apiKey =
      userApiKey ||
      process.env[sourcifyChain.etherscanApi.apiKeyEnvName || ""] ||
      process.env.ETHERSCAN_API_KEY ||
      "";

    return await LibSourcify.fetchFromEtherscan(
      sourcifyChain.chainId,
      address,
      apiKey,
    );
  } catch (err) {
    return mapLibError(err, throwV2Errors);
  }
};

export const processSolidityResultFromEtherscan = (
  contractResultJson: any,
  throwV2Errors: boolean,
) => {
  try {
    return LibSourcify.processSolidityResultFromEtherscan(contractResultJson);
  } catch (err) {
    return mapLibError(err, throwV2Errors);
  }
};

export const processVyperResultFromEtherscan = async (
  contractResultJson: any,
  throwV2Errors: boolean,
) => {
  try {
    return await LibSourcify.processVyperResultFromEtherscan(
      contractResultJson,
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
  if (isVyperResult(etherscanResult)) {
    const processedResult = await processVyperResultFromEtherscan(
      etherscanResult,
      throwV2Errors,
    );
    return new VyperCompilation(
      vyperCompiler,
      processedResult.compilerVersion,
      processedResult.jsonInput as VyperJsonInput,
      {
        path: processedResult.contractPath,
        name: processedResult.contractName,
      },
    );
  } else {
    const processedResult = processSolidityResultFromEtherscan(
      etherscanResult,
      throwV2Errors,
    );
    return new SolidityCompilation(
      solc,
      processedResult.compilerVersion,
      processedResult.jsonInput as SolidityJsonInput,
      {
        path: processedResult.contractPath,
        name: processedResult.contractName,
      },
    );
  }
}
