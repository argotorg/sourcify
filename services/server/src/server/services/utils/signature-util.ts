import { Interface, id as keccak256str, Fragment, JsonFragment } from "ethers";

export interface SignatureData {
  signature: string;
  signatureHash32: string;
  signatureType: "function" | "event" | "error";
}

export function extractSignaturesFromAbi(abi: JsonFragment[]): SignatureData[] {
  const signatures: SignatureData[] = [];

  const iface = new Interface(abi);

  iface.fragments.forEach((fragment) => {
    switch (fragment.type) {
      case "function":
      case "event":
      case "error":
        signatures.push(getSignatureData(fragment));
    }
  });

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
