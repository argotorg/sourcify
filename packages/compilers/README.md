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

## Compilation timeout

The last argument of `useSolidityCompiler`, `useVyperCompiler` and `useFeCompiler` is an optional wall-clock timeout in milliseconds for the compilation. When it elapses the call rejects with an error whose `code` is `COMPILER_TIMEOUT` (exported as `COMPILER_TIMEOUT_CODE` from `@ethereum-sourcify/compilers-types`). If omitted, a default of 45 minutes applies.

It covers all three ways a compiler is run, each of which needs a different mechanism to stop it:

- native `solc`/`vyper` binaries run as a child process and are killed with `SIGKILL`
- `fe build` runs synchronously via `spawnSync`, which enforces the timeout itself
- the soljson (Emscripten) build of `solc` runs in-process in a worker thread — there is no process to kill, so the thread is terminated instead
