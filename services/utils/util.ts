import Path from "path";
import fs from "fs";
import {
  V1MatchLevelWithoutAny,
  MatchQuality,
  MatchLevel,
  Match,
} from "../../routes/types";
import { getAddress } from "ethers";
import {
  VerificationStatus,
  VerificationExport,
} from "@ethereum-sourcify/lib-sourcify";
import { ProxyAgent, setGlobalDispatcher } from "undici";

export const getFileRelativePath = (
  chainId: number,
  address: string,
  contractStatus: MatchQuality,
  file: string,
  { isSource } = { isSource: false },
): string => {
  const baseDir = Path.join(
    "contracts",
    contractStatus === "full" ? "full_match" : "partial_match",
    String(chainId),
    address,
  );

  return isSource
    ? Path.join(baseDir, "sources", file)
    : Path.join(baseDir, file);
};

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.promises.access(path);
    return true;
  } catch (e) {
    return false;
  }
}

export async function readFile(
  repositoryPath: string,
  matchType: V1MatchLevelWithoutAny,
  chainId: string,
  address: string,
  path: string,
): Promise<string | false> {
  const fullPath = Path.join(
    repositoryPath,
    "contracts",
    matchType as string,
    chainId,
    getAddress(address),
    path,
  );
  try {
    const loadedFile = await fs.promises.readFile(fullPath);
    return loadedFile.toString() || false;
  } catch (e) {
    return false;
  }
}

/**
 * This function returns a positive number if the first VerificationStatus
 * is better than the second one; 0 if they are the same; or a
 * negative number if the first VerificationStatus is worse than the second one
 */
export function getStatusDiff(
  status1: VerificationStatus,
  status2: VerificationStatus,
): number {
  const scores = {
    error: 0,
    "extra-file-input-bug": 0,
    partial: 1,
    perfect: 2,
  };
  const status1Value = status1 != null ? scores[status1] : 0;
  const status2Value = status2 != null ? scores[status2] : 0;
  return status1Value - status2Value;
}

/**
 * Verify that either the newVerification runtime or creation match is better
 * ensuring that neither the newVerification runtime nor creation is worse
 * than the existing verification
 */
export function isBetterVerification(
  newVerification: VerificationExport,
  existingMatch: Match,
): boolean {
  if (
    /** if newMatch.creationMatch is better */
    getStatusDiff(
      newVerification.status.creationMatch,
      existingMatch.creationMatch,
    ) > 0 &&
    /** and newMatch.runtimeMatch is not worse */
    getStatusDiff(
      newVerification.status.runtimeMatch,
      existingMatch.runtimeMatch,
    ) >= 0
  ) {
    return true;
  }
  if (
    /** if newMatch.runtimeMatch is better */
    getStatusDiff(
      newVerification.status.runtimeMatch,
      existingMatch.runtimeMatch,
    ) > 0 &&
    /** and newMatch.creationMatch is not worse */
    getStatusDiff(
      newVerification.status.creationMatch,
      existingMatch.creationMatch,
    ) >= 0
  ) {
    return true;
  }
  return false;
}

export function toMatchLevel(status: VerificationStatus): MatchLevel {
  switch (status) {
    case "perfect":
      return "exact_match";
    case "partial":
      return "match";
    default:
      return null;
  }
}

export function toVerificationStatus(level: MatchLevel): VerificationStatus {
  switch (level) {
    case "exact_match":
      return "perfect";
    case "match":
      return "partial";
    default:
      return null;
  }
}

export function getTotalMatchLevel(
  creationStatus: VerificationStatus,
  runtimeStatus: VerificationStatus,
): MatchLevel {
  if (
    ![creationStatus, runtimeStatus].find(
      (status) => status === "partial" || status === "perfect",
    )
  ) {
    return null;
  }
  if (creationStatus === "perfect" || runtimeStatus === "perfect") {
    return "exact_match";
  }
  return "match";
}

export function getMatchStatus(verificationStatus: {
  runtimeMatch: string;
  creationMatch: string;
}): VerificationStatus {
  if (
    verificationStatus.runtimeMatch === "perfect" ||
    verificationStatus.creationMatch === "perfect"
  ) {
    return "perfect";
  }
  if (
    verificationStatus.runtimeMatch === "partial" ||
    verificationStatus.creationMatch === "partial"
  ) {
    return "partial";
  }
  if (verificationStatus.runtimeMatch === "extra-file-input-bug") {
    return "extra-file-input-bug";
  }
  return null;
}

export function reduceAccessorStringToProperty(
  accessorString: string, // for example "deployment.blockNumber"
  obj: Record<string, any>,
): string | Record<string, any> {
  return accessorString
    .split(".")
    .reduce((current: Record<string, any>, field) => {
      if (!current[field]) {
        throw new Error(`String ${accessorString} is not a valid property`);
      }
      return current[field];
    }, obj);
}

export function enableHttpProxy(options: ProxyAgent.Options | string) {
  if (!options) {
    return;
  }
  const proxyAgent = new ProxyAgent(options);
  setGlobalDispatcher(proxyAgent);
}
