import { id as keccak256str, Fragment, JsonFragment } from "ethers";
import canonicalSignaturesData from "./canonical-signatures.json";

export enum SignatureType {
  Function = "function",
  Event = "event",
  Error = "error",
}

export interface SignatureData {
  signature: string;
  signatureHash32: string;
  signatureType: SignatureType;
}

export function extractSignaturesFromAbi(abi: JsonFragment[]): SignatureData[] {
  const signatures: SignatureData[] = [];

  for (const item of abi) {
    let fragment: Fragment;
    try {
      fragment = Fragment.from(item);
    } catch (error) {
      // Ignore invalid fragments such as custom types appearing in library ABIs
      continue;
    }

    switch (fragment.type) {
      case SignatureType.Function:
      case SignatureType.Event:
      case SignatureType.Error:
        signatures.push(getSignatureData(fragment));
        break;
      default:
        break;
    }
  }

  return signatures;
}

function getSignatureData(fragment: Fragment): SignatureData {
  const signature = fragment.format("sighash");
  return {
    signature,
    signatureHash32: keccak256str(signature),
    signatureType: fragment.type as SignatureType,
  };
}

// prettier-ignore
export function getCanonicalSignatures(): 
Record<
  string,
  { signature?: string }
  > {
  return canonicalSignaturesData as Record<string, { signature?: string }>;
}
