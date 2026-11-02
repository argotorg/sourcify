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

## Solar

<!-- TODO(solar release): use the real release version in the examples -->

[Solar](https://github.com/paradigmxyz/solar) compiles Solidity with the same standard JSON input and output as solc. `useSolarCompiler(solarRepoPath, version, solarJsonInput, timeoutMs?)` takes the solc-compatible version that `SOLC_WRAPPER=1 solar --version` prints, for example `0.8.38+commit.d9f23fbe.solar.0.3.0`. The version names the Solar release and the commit of the build.

- For a release, the function downloads `solar-<target>.tar.gz` from the GitHub release and checks that the binary reports the requested commit.
- A build that is not a release, such as `0.3.0-dev`, cannot be downloaded. Put it in `solarRepoPath` as `solar-<target>-v<solar version>+commit.<commit>`, for example `solar-x86_64-unknown-linux-musl-v0.3.0-dev+commit.d9f23fbe`.

## Compilation timeout

The last argument of `useSolidityCompiler`, `useVyperCompiler`, `useSolarCompiler` and `useFeCompiler` is an optional wall-clock timeout in milliseconds for the compilation. When it elapses the call rejects with an error whose `code` is `COMPILER_TIMEOUT` (exported as `COMPILER_TIMEOUT_CODE` from `@ethereum-sourcify/compilers-types`). If omitted, a default of 45 minutes applies.

It covers all three ways a compiler is run, each of which needs a different mechanism to stop it:

- native `solc`/`vyper`/`solar` binaries run as a child process and are killed with `SIGKILL`
- `fe build` runs synchronously via `spawnSync`, which enforces the timeout itself
- the soljson (Emscripten) build of `solc` runs in-process in a worker thread — there is no process to kill, so the thread is terminated instead
