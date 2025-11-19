import { getAddress, isAddress } from "ethers";
import { BadRequestError } from "../../common/errors";
import type { ChainRepository } from "../../sourcify-chain-repository";
import type { OpenApiValidatorOpts } from "express-openapi-validator/dist/framework/types";

export function makeV1ValidatorFormats(
  chainRepository: ChainRepository,
): OpenApiValidatorOpts["formats"] {
  return {
    "comma-separated-addresses": {
      type: "string",
      validate: (addresses: string) => validateAddresses(addresses),
    },
    address: {
      type: "string",
      validate: (address: string) => validateSingleAddress(address),
    },
    "comma-separated-sourcify-chainIds": {
      type: "string",
      validate: (chainIds: string) =>
        chainRepository.validateSourcifyChainIds(chainIds),
    },
    "supported-chainId": {
      type: "string",
      validate: (chainId: string) =>
        chainRepository.checkSupportedChainId(chainId),
    },
    // "Sourcify chainIds" include the chains that are revoked verification support, but can have contracts in the repo.
    "sourcify-chainId": {
      type: "string",
      validate: (chainId: string) =>
        chainRepository.checkSourcifyChainId(chainId),
    },
    "match-type": {
      type: "string",
      validate: (matchType: string) =>
        matchType === "full_match" || matchType === "partial_match",
    },
  };
}

const validateSingleAddress = (address: string): boolean => {
  if (!isAddress(address)) {
    throw new BadRequestError(`Invalid address: ${address}`);
  }
  return true; // if it doesn't throw
};

const validateAddresses = (addresses: string): boolean => {
  const addressesArray = addresses.split(",");
  const invalidAddresses: string[] = [];
  for (const i in addressesArray) {
    const address = addressesArray[i];
    if (!isAddress(address)) {
      invalidAddresses.push(address);
    } else {
      addressesArray[i] = getAddress(address);
    }
  }

  if (invalidAddresses.length) {
    throw new BadRequestError(
      `Invalid addresses: ${invalidAddresses.join(", ")}`,
    );
  }
  return true; // if it doesn't throw
};
