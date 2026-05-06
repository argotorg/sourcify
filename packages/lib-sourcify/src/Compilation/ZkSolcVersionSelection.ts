import { AuxdataStyle, decode } from '@ethereum-sourcify/bytecode-utils';
import semver from 'semver';

export interface ZkSolcVersionCandidateOptions {
  availableZkSolcVersions: string[];
  requestedZkSolcVersion?: string;
  bytecodes?: string[];
}

function normalizeOptionalV(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

function getSortableSemver(version: string): semver.SemVer | null {
  const withoutV = normalizeOptionalV(version);
  const vmMatch = withoutV.match(/^vm-(\d+\.\d+\.\d+)/);
  return semver.parse(vmMatch?.[1] || withoutV) || semver.coerce(withoutV);
}

export function sortZkSolcVersionsNewestFirst(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const aSemver = getSortableSemver(a);
    const bSemver = getSortableSemver(b);

    if (aSemver && bSemver) {
      return semver.rcompare(aSemver, bSemver);
    }
    if (aSemver) {
      return -1;
    }
    if (bSemver) {
      return 1;
    }
    return b.localeCompare(a);
  });
}

function parseZkSolcVersionFromCompilerString(
  compilerString: string,
): string | undefined {
  const match = compilerString.match(/(?:^|;)zksolc:([^;]+)/);
  return match?.[1];
}

function decodeHexAscii(bytecode: string): string {
  const hex = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
  let result = '';
  for (let i = 0; i < hex.length - 1; i += 2) {
    const value = parseInt(hex.slice(i, i + 2), 16);
    if (!Number.isNaN(value)) {
      result += String.fromCharCode(value);
    }
  }
  return result;
}

export function findZkSolcVersionInBytecode(
  bytecode: string,
): string | undefined {
  try {
    const decoded = decode(bytecode, AuxdataStyle.SOLIDITY);
    if (decoded.solcVersion) {
      const zksolcVersion = parseZkSolcVersionFromCompilerString(
        decoded.solcVersion,
      );
      if (zksolcVersion) {
        return zksolcVersion;
      }
    }
  } catch {
    // Fall back to a raw ASCII scan below.
  }

  const ascii = decodeHexAscii(bytecode);
  return parseZkSolcVersionFromCompilerString(ascii);
}

function findAvailableVersion(
  availableVersions: string[],
  version: string,
): string | undefined {
  const normalizedVersion = normalizeOptionalV(version);
  return availableVersions.find(
    (availableVersion) =>
      normalizeOptionalV(availableVersion) === normalizedVersion,
  );
}

export function getZkSolcVersionCandidates({
  availableZkSolcVersions,
  requestedZkSolcVersion,
  bytecodes = [],
}: ZkSolcVersionCandidateOptions): string[] {
  if (requestedZkSolcVersion) {
    return [requestedZkSolcVersion];
  }

  const sortedAvailableVersions = sortZkSolcVersionsNewestFirst(
    availableZkSolcVersions,
  );

  for (const bytecode of bytecodes) {
    const bytecodeZkSolcVersion = findZkSolcVersionInBytecode(bytecode);
    if (!bytecodeZkSolcVersion) {
      continue;
    }

    const matchedAvailableVersion = findAvailableVersion(
      sortedAvailableVersions,
      bytecodeZkSolcVersion,
    );
    if (matchedAvailableVersion) {
      return [
        matchedAvailableVersion,
        ...sortedAvailableVersions.filter(
          (version) => version !== matchedAvailableVersion,
        ),
      ];
    }
  }

  return sortedAvailableVersions;
}
