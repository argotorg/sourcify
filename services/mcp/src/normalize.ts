import type { MatchStatus } from "./SourcifyClient";

/** Human-facing verification status, normalized from the v2 `match` vocabulary. */
export type VerificationStatus = "exact" | "partial" | "unverified";

/**
 * Maps the Sourcify v2 match vocabulary to a stable, agent-friendly status:
 * `exact_match` (full) → `exact`, `match` (partial) → `partial`,
 * `null`/absent → `unverified`.
 */
export function toVerificationStatus(
  match: MatchStatus | undefined,
): VerificationStatus {
  if (match === "exact_match") return "exact";
  if (match === "match") return "partial";
  return "unverified";
}
