import { BigQuery } from "@google-cloud/bigquery";
import { GoogleAuth, Impersonated } from "google-auth-library";

let clientPromise: Promise<BigQuery> | null = null;
// Returns a singleton BigQuery client. If BQ_IMPERSONATE_SERVICE_ACCOUNT is set,
// the client uses IAM Credentials API to impersonate that service account.
// We need impersonation because our server’s default service account may
// eventually need BigQuery write permissions. By impersonating a dedicated read-only SA
// we keep reads and writes separated.
export async function getBigQuery(): Promise<BigQuery> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const projectId = process.env.BQ_BILLING_PROJECT_ID || undefined;

      const targetSA = (
        process.env.BQ_IMPERSONATE_SERVICE_ACCOUNT || ""
      ).trim();
      if (targetSA) {
        const sourceAuth = new GoogleAuth({
          // Cloud Platform scope is needed to mint impersonated tokens
          scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });
        const sourceClient = await sourceAuth.getClient();
        const impersonated = new Impersonated({
          sourceClient,
          targetPrincipal: targetSA,
          targetScopes: ["https://www.googleapis.com/auth/bigquery"],
          lifetime: 3600,
          delegates: [],
        });
        return new BigQuery({ projectId, authClient: impersonated });
      }

      // Default: use ADC without impersonation
      return new BigQuery({ projectId });
    })();
  }
  return clientPromise;
}

// Config
export const BQ_LOCATION = process.env.BQ_LOCATION;

// Per-query hard cap in **MiB** (binary). Default 50 MiB.
export const BQ_MAX_BYTES_BILLED_MIB = parseInt(
  process.env.BQ_MAX_BYTES_BILLED_MIB || "50",
  10,
);
export const BQ_MAX_BYTES_BILLED =
  BigInt(BQ_MAX_BYTES_BILLED_MIB) * BigInt(1048576);

// Optional: comma-separated allowlist of dataset prefixes ("project.dataset")
const raw = (process.env.BQ_ALLOWLIST_DATASETS || "").trim();
export const BQ_ALLOWLIST_DATASETS = raw.length
  ? raw.split(",").map((s) => s.trim())
  : [];

// Utility
export const toMiB = (bytes: bigint | number) => {
  const n = typeof bytes === "bigint" ? Number(bytes) : bytes;
  return n / 1048576;
};
