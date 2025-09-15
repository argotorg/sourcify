import { id as keccak256str, Fragment, JsonFragment } from "ethers";
import logger from "../../../common/logger";
import yamljs from "yamljs";

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
      // Ignore invalid fragments
      // e.g. with custom type as they can appear in library ABIs
      continue;
    }
    switch (fragment.type) {
      case SignatureType.Function:
      case SignatureType.Event:
      case SignatureType.Error:
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

interface CanonicalSignatureCache {
  // hash -> canonical signature or null
  // null means no canonical signature (e.g. system magics)
  signatures: Map<string, string | null>;
  lastFetch: number;
}

let canonicalSignatureCache: CanonicalSignatureCache | null = null;
const CANONICAL_CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours default

export const getCanonicalSignatures = async (
  cacheDurationMs: number = CANONICAL_CACHE_DURATION_MS,
): Promise<Map<string, string | null>> => {
  const now = Date.now();
  if (
    !canonicalSignatureCache ||
    now - canonicalSignatureCache.lastFetch > cacheDurationMs
  ) {
    try {
      const response = await fetch(
        "https://raw.githubusercontent.com/openchainxyz/canonical-signatures/main/canonical.yaml",
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const yamlText = await response.text();
      const signatures = parseCanonicalSignaturesYaml(yamlText);

      canonicalSignatureCache = {
        signatures,
        lastFetch: now,
      };
    } catch (error) {
      logger.error("Failed to fetch canonical signatures", { error });
      if (canonicalSignatureCache) {
        logger.warn("Using stale canonical signatures cache");
      } else {
        logger.warn("Not using canonical signatures cache");
        return new Map();
      }
    }
  }

  return canonicalSignatureCache.signatures;
};

function parseCanonicalSignaturesYaml(
  yamlText: string,
): Map<string, string | null> {
  const signatures = new Map<string, string | null>();

  try {
    const parsedYaml = yamljs.parse(yamlText);

    if (parsedYaml && typeof parsedYaml === "object") {
      for (const [hash, value] of Object.entries(parsedYaml)) {
        if (value && typeof value === "object" && "signature" in value) {
          signatures.set(hash, value.signature as string);
        } else {
          // System magics don't have a canonical signature. They should be filtered in any case.
          signatures.set(hash, null);
        }
      }
    } else {
      throw new Error("Invalid YAML structure");
    }
  } catch (error) {
    logger.error("Failed to parse canonical signatures YAML", { error });
    throw error;
  }

  return signatures;
}
