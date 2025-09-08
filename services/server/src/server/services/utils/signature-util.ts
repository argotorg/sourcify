import { id as keccak256str, Fragment, JsonFragment } from "ethers";

export interface SignatureData {
  signature: string;
  signatureHash32: string;
  signatureType: "function" | "event" | "error";
}

export function extractSignaturesFromAbi(abi: JsonFragment[]): SignatureData[] {
  const signatures: SignatureData[] = [];

  try {
    for (const item of abi) {
      const fragment = Fragment.from(item);
      switch (fragment.type) {
        case "function":
        case "event":
        case "error":
          signatures.push(getSignatureData(fragment));
      }
    }
  } catch (error) {
    throw new Error(
      "Failed to extract signatures from ABI due to an invalid fragment",
    );
  }

  return signatures;
}

function getSignatureData(fragment: Fragment): SignatureData {
  const signature = fragment.format("sighash");
  return {
    signature,
    signatureHash32: keccak256str(signature),
    signatureType: fragment.type as "function" | "event" | "error",
  };
}
