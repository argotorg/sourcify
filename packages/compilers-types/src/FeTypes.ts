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
 *
 * Since v26.3.0, `fe build --emit metadata` writes a `<Contract>.metadata.json`
 * recompilation input, and `fe build --from-metadata` rebuilds from it. Its
 * `sources` and `settings` fit this interface. An input whose settings carry
 * `ingots` is compiled with `--from-metadata`, which restores the ingot names,
 * the dependency ingots and the optimizer level of the original build.
 */

/** One ingot of a Fe build, as recorded in `settings.ingots` of Fe metadata. */
export interface FeIngotSettings {
  /** Ingot name from fe.toml. It is part of the symbols, so it changes the bytecode. */
  name: string;
  /** Ingot version, or null for a standalone file */
  version?: string | null;
  /** "" for the root ingot. Dependency sources are keyed by `<namespace>/...` */
  namespace: string;
  arithmetic?: string;
  dependencyArithmetic?: string;
  /** Dependency alias to namespace, with "std" and "core" for the builtin ingots */
  dependencies?: Record<string, string>;
}

/**
 * The `settings` object of Fe metadata (`fe build --emit metadata`), with the
 * fields Fe writes. `fe build --from-metadata` reads `ingots` (including the
 * per-ingot `arithmetic`), `optimizer` and `compilationTarget`.
 */
export interface FeMetadataSettings {
  ingots: FeIngotSettings[];
  optimizer?: { level: string };
  /** `{ "<source path>": "<contract name>" }` */
  compilationTarget?: Record<string, string>;
  /** Written by Fe for information. The rebuild does not read it. */
  evmVersion?: string;
  /** Written by Fe for information. The rebuild reads `ingots[].arithmetic`. */
  arithmetic?: string;
  /** Written by Fe for information. The rebuild does not read it. */
  dependencyArithmetic?: string;
  /** Fe has no output selection. Typed for code that strips it from any settings. */
  outputSelection?: never;
}

/**
 * Either the empty object (one ingot named `sourcify_verification`, default
 * optimizer level), or the `settings` of Fe metadata.
 */
export type FeSettings = Record<string, never> | FeMetadataSettings;

export interface FeJsonInput {
  language: "Fe";
  /**
   * Source files. With empty settings, keyed by path under src/
   * (e.g. `src/lib.fe`). With metadata settings, keyed as in Fe metadata:
   * root ingot files by `src/...` (or a bare `<file>.fe` for a standalone
   * file), dependency files by `<namespace>/src/...`.
   */
  sources: {
    [sourcePath: string]: {
      content: string;
      /** Written by `fe build --emit metadata`. Not checked by Sourcify or Fe. */
      keccak256?: string;
    };
  };
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
