import { id as keccak256str, Fragment, JsonFragment } from "ethers";

export type SignatureType = "function" | "event" | "error";

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
      // Ignore invalid fragments
      // e.g. with custom type as they can appear in library ABIs
      continue;
    }
    switch (fragment.type) {
      case "function":
      case "event":
      case "error":
        signatures.push(getSignatureData(fragment));
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
