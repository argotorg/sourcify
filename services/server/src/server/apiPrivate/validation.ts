import { isAddress } from "ethers";
import { BadRequestError } from "../../common/errors";
import type { OpenApiValidatorOpts } from "express-openapi-validator/dist/framework/types";

// Custom OpenAPI formats needed by the private endpoints (apiPrivate/paths.yaml).
// The private request bodies validate `address` with `format: address`.
export function makePrivateValidatorFormats(): OpenApiValidatorOpts["formats"] {
  return {
    address: {
      type: "string",
      validate: (address: string) => validateSingleAddress(address),
    },
  };
}

const validateSingleAddress = (address: string): boolean => {
  if (!isAddress(address)) {
    throw new BadRequestError(`Invalid address: ${address}`);
  }
  return true; // if it doesn't throw
};
