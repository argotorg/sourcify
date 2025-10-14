import canonicalSignaturesData from "./canonical-signatures.json";
import { Fragment } from "ethers";

export enum SignatureType {
  Function = "function",
  Event = "event",
}

// prettier-ignore
export function getCanonicalSignatures():
Record<
  string,
  { signature?: string }
  > {
  return canonicalSignaturesData as Record<string, { signature?: string }>;
}

// Use ethers.js Fragment.from() to validate signature instead of custom parser.
export function validateSignature(signature: string): boolean {
  try {
    const fullSignature = `function ${signature}`; // ethers uses "Human Readable ABI" for parsing and requires type keyword. Assume it's a function. https://docs.ethers.org/v5/api/utils/abi/formats/#abi-formats--human-readable-abi
    Fragment.from(fullSignature);
    return true;
  } catch {
    return false;
  }
}
