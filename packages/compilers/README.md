# compilers

Wrapper around multiple compilers to download the right version and invoke the compilation with a common interface.

## Install

```
npm i @ethereum-sourcify/compilers
```

## Usage

```ts
import {
  SolidityOutput,
  ISolidityCompiler,
  JsonInput,
} from '@ethereum-sourcify/lib-sourcify';
import { useSolidityCompiler } from '@ethereum-sourcify/compilers';

class SolcLocal implements ISolidityCompiler {
  constructor(
    private solcRepoPath: string,
    private solJsonRepoPath: string,
    private timeoutMs?: number,
  ) {}

  async compile(
    version: string,
    solcJsonInput: JsonInput,
    forceEmscripten: boolean = false,
  ): Promise<SolidityOutput> {
    return await useSolidityCompiler(
      this.solcRepoPath,
      this.solJsonRepoPath,
      version,
      solcJsonInput,
      forceEmscripten,
      this.timeoutMs,
    );
  }
}
```

The `SolcLocal` class can then be used as the `solidityCompiler` argument of the constructor of `SolidityCheckedContract`.
Vyper follows the same pattern.

## Historical Vyper storage layouts

Vyper versions before `0.4.1b4` either omit storage layout from Standard JSON
or do not expose a native layout format. `useVyperStorageLayout` recovers the
compiler-assigned layout from `0.1.0-beta.16` onward using the exact Vyper
package in an isolated Python process:

```ts
import { useVyperStorageLayout } from '@ethereum-sourcify/compilers';

const layout = await useVyperStorageLayout(
  '/path/to/vyper/repo',
  version,
  vyperJsonInput,
  compilationTargetPath,
);
```

This path requires [uv](https://docs.astral.sh/uv/) on `PATH`. Set
`VYPER_UV_PATH` to use another executable or `VYPER_PROCESS_TIMEOUT_MS` to
override the five-minute process timeout. The uv-managed Python runtimes and
compiler environments are cached below the Vyper repository path.

`useVyperCompiler` also uses this isolated path when an official release has
no downloadable compiler binary, as with Vyper `0.2.9`, `0.2.10`, `0.2.13`,
`0.2.14`, `0.3.5`, `0.3.10rc1`, `0.4.0b2`, and `0.4.0b3`. PyPI never
published `0.2.0`, so its code-identical `0.2.1` package is used only for
supplemental layout extraction.

The returned object deliberately follows Vyper's existing flat layout schema.
Entries that reference historical structs add a `type_definitions` table with
the compiler-derived member names, relative slots, types, and spans.
For Vyper through `0.2.12`, a composite's `n_slots: 1` is its compiler-assigned
hashed root slot, not an inline Solidity-style span. Consumers must retain the
verified compiler version when interpreting those historical entries.

## Compilation timeout

The last argument of `useSolidityCompiler`, `useVyperCompiler` and `useFeCompiler` is an optional wall-clock timeout in milliseconds for the compilation. When it elapses the call rejects with an error whose `code` is `COMPILER_TIMEOUT` (exported as `COMPILER_TIMEOUT_CODE` from `@ethereum-sourcify/compilers-types`). If omitted, a default of 45 minutes applies.

It covers all three ways a compiler is run, each of which needs a different mechanism to stop it:

- native `solc`/`vyper` binaries run as a child process and are killed with `SIGKILL`
- `fe build` runs synchronously via `spawnSync`, which enforces the timeout itself
- the soljson (Emscripten) build of `solc` runs in-process in a worker thread — there is no process to kill, so the thread is terminated instead
