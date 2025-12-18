import logger from "./logger";
import type { Logger } from "winston";
import type { SimilarityVerificationConfig } from "./types";

const trimTrailingSlash = (url: string) => url.replace(/\/+$/, "");

export default class SimilarityVerificationClient {
  private baseUrls: string[];
  private clientLogger: Logger;
  private requestDelay: number;

  constructor(baseUrls: string[], options: SimilarityVerificationConfig) {
    this.baseUrls = baseUrls.map((url) => trimTrailingSlash(url));
    this.clientLogger = logger.child({ moduleName: "SimilarityVerification" });
    this.requestDelay = options.requestDelay ?? 15 * 1000;
  }

  trigger = (
    chainId: number,
    address: string,
    creationTransactionHash?: string,
  ) => {
    this.baseUrls.forEach(async (baseUrl) => {
      // Give time to the explorer to index the new contract before triggering similarity verification
      await new Promise((resolve) => setTimeout(resolve, this.requestDelay));
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
