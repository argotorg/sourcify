import type {
  SolidityJsonInput,
  SolidityOutput,
  SoliditySettings,
} from "./SolidityTypes";

// Slang takes the solc standard JSON input with its own extra settings
export interface SlangSettings extends Omit<SoliditySettings, "optimizer"> {
  // Slang ignores the solc optimizer fields and reads only its own
  optimizer?: SoliditySettings["optimizer"] & {
    // LLVM optimization level: "1", "2", "3", "s" or "z"
    mode?: string;
    sizeFallback?: boolean;
  };
  // The Solidity language version that the sources are compiled as
  solidityVersion?: string;
  llvmOptions?: string[];
}

export interface SlangJsonInput extends SolidityJsonInput {
  settings: SlangSettings;
}

// Slang returns the solc standard JSON output format
export type SlangOutput = SolidityOutput;

// <slang version>+slang, the long version that Hardhat reports for Slang
const SLANG_VERSION_REGEX = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\+slang$/;

export interface SlangVersion {
  // The Slang version, e.g. 0.2.0, or 0.2.0-pre.2026-11-12 for a pre-release
  slangVersion: string;
}

export function parseSlangVersion(version: string): SlangVersion | undefined {
  // Stored or user data may lack a version
  if (typeof version !== "string") {
    return undefined;
  }
  const match = SLANG_VERSION_REGEX.exec(version.trim());
  if (!match) {
    return undefined;
  }
  return { slangVersion: match[1] };
}

export function isSlangVersion(version: string): boolean {
  return parseSlangVersion(version) !== undefined;
}
