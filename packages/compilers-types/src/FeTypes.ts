import type { JsonFragment } from "ethers";

/*
 * Fe has no official standard JSON I/O (unlike Solidity/Vyper which define a
 * well-specified JSON compiler interface). `FeJsonInput` is an **adapted
 * interface** modeled after the std-JSON shape, allowing Fe to plug into
 * Sourcify's existing compilation and verification framework without
 * special-casing every caller. Internally, `feCompiler.ts` translates this
 * into an ingot directory structure (`fe.toml` + `src/` files) before
 * invoking the Fe CLI.
 *
 * ABI output is supported starting from v26.0.0-alpha.12 (`ContractName.abi.json`).
 * Older versions are not supported.
 */

/** Fe has no compiler settings */
export type FeSettings = Record<string, never>;

export interface FeJsonInput {
  language: "Fe";
  /** Source files keyed by path relative to src/ */
  sources: {
    [sourcePath: string]: {
      content: string;
    };
  };
  /** Fe alpha has no configurable settings; pass an empty object or omit entirely */
  settings: FeSettings;
}

export interface FeOutputContract {
  /** ABI JSON array (always present for supported Fe versions >= v26.0.0-alpha.12) */
  abi: JsonFragment[];
  /** Fe does not emit userdoc */
  userdoc?: never;
  /** Fe does not emit devdoc */
  devdoc?: never;
  evm: {
    bytecode: {
      /** Hex string without 0x prefix */
      object: string;
    };
    deployedBytecode: {
      /** Hex string without 0x prefix */
      object: string;
      /** Fe does not emit source maps */
      sourceMap?: never;
    };
  };
}

export interface FeOutputError {
  severity: "error" | "warning";
  message: string;
}

interface FeOutputContracts {
  [sourcePath: string]: {
    [contractName: string]: FeOutputContract;
  };
}

export interface FeOutput {
  compiler: string;
  errors?: FeOutputError[];
  contracts: FeOutputContracts;
  /** Fe compiler does not emit source IDs — this field is always absent */
  sources?: undefined;
}
