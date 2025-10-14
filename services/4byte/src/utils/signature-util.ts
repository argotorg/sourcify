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

// Unified signature validation using ethers.js Fragment.from()
export function validateSignature(signature: string): boolean {
  try {
    const fragment = Fragment.from(signature);
    // Fragment.from() succeeds = valid signature
    return ["function", "event", "error"].includes(fragment.type);
  } catch (error) {
    // Fragment.from() throws = invalid signature
    return false;
  }
}
