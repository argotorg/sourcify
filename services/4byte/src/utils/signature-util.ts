import canonicalSignaturesData from "./canonical-signatures.json";

export enum SignatureType {
  Function = "function",
  Event = "event",
  Error = "error",
}

// prettier-ignore
export function getCanonicalSignatures(): 
Record<
  string,
  { signature?: string }
  > {
  return canonicalSignaturesData as Record<string, { signature?: string }>;
}
