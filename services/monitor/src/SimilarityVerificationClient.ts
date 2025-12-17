import logger from "./logger";
import type { Logger } from "winston";

const trimTrailingSlash = (url: string) => url.replace(/\/+$/, "");

export default class SimilarityVerificationClient {
  private baseUrls: string[];
  private clientLogger: Logger;

  constructor(baseUrls: string[]) {
    this.baseUrls = baseUrls.map((url) => trimTrailingSlash(url));
    this.clientLogger = logger.child({ moduleName: "SimilarityVerification" });
  }

  trigger = async (
    chainId: number,
    address: string,
    creationTransactionHash?: string,
  ): Promise<void> => {
    this.baseUrls.forEach(async (baseUrl) => {
      const url = `${baseUrl}/v2/verify/similarity/${chainId}/${address}`;
      try {
        this.clientLogger.info("Triggering similarity verification", {
          chainId,
          address,
          baseUrl,
        });
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "sourcify-monitor",
          },
          body: JSON.stringify({
            ...(creationTransactionHash
              ? { creationTransactionHash }
              : undefined),
          }),
        });

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            `Similarity verification request failed: ${response.status} ${response.statusText} - ${responseText}`,
          );
        }

        this.clientLogger.info("Similarity verification triggered", {
          chainId,
          address,
          baseUrl,
        });
      } catch (error: any) {
        this.clientLogger.warn("Error triggering similarity verification", {
          chainId,
          address,
          baseUrl,
          error,
        });
      }
    });
  };
}
