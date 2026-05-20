# ZkSolc Compiler Internals

Reviewer-oriented notes on how zksolc / EraVM verification resolves and runs
compilers. Companion to the "Solc Compiler Internals" section in `CLAUDE.md`.

## Three compilers, three roles

zksolc verification involves three distinct compiler binaries. zksolc is the
orchestrator; the other two are interchangeable backends it shells out to via
`--solc <path>`.

| Compiler          | Role                                                                                     | Repo                                                                            | Filename pattern                     | Version examples                                                           |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| **zksolc**        | EraVM wrapper; takes Solidity standard JSON, spawns a solc backend, emits EraVM bytecode | `matter-labs/era-compiler-solidity` (≥1.5) or `matter-labs/zksolc-bin` (legacy) | `zksolc-<platform>-v<version>[.exe]` | `v1.5.16`, `v1.4.1`, `vm-1.5.0-a167aa3` (one-off)                          |
| **era-solc**      | Matter Labs' fork of solc with EraVM patches; invoked by zksolc as the `--solc` backend  | `matter-labs/era-solidity`                                                      | `solc-<platform>-<version>[.exe]`    | `0.8.30-1.0.2`, `0.8.26-1.0.1`, `0.7.6-1.0.1` (sometimes `zkVM-`-prefixed) |
| **upstream solc** | Plain Ethereum solc; also usable as zksolc's `--solc` backend                            | `binaries.soliditylang.org/bin/` (reused via the existing solc downloader)      | (existing solc convention)           | `v0.8.26+commit.8a97fa7a`, `0.8.26`                                        |

The era-solc version format is `<solc-semver>-<era-edition>`. Editions: `1.0.0`,
`1.0.1`, `1.0.2`. Edition `1.0.0` only covers solc ≤ 0.8.25; edition `1.0.2`
requires zksolc ≥ 1.5.

Upstream solc is used because block-explorer submissions usually only know the
commit-bearing solc version, not the era-solc edition. `ZkSolcCompilation` tries
upstream solc first (when given a commit-bearing version), then falls back
through era-solc candidates.

## The 1.5.0 split

zksolc changed its API/CLI shape at 1.5.0. Three practical consequences:

**1. CLI shape.** Before 1.5.0, certain settings are passed as **CLI flags**
rather than via standard JSON:

- `--system-mode` ← `settings.enableEraVMExtensions` / `settings.isSystem`
- `--force-evmla` ← `settings.forceEVMLA` / `settings.forceEvmla`

`getZkSolcStandardJsonArgs` in `zksolcCompiler.ts` handles this mapping. From
1.5.0 onward these go through standard JSON unchanged.

**2. Output selection.** Pre-1.5 zksolc rejects `evm` in `outputSelection`.
`mergeOutputSelection` in `ZkSolcCompilation.ts` selects `[abi, metadata]` for
pre-1.5 vs `[abi, metadata, evm]` for ≥1.5.

**3. era-solc edition compatibility.** Edition `1.0.2` is only available with
zksolc ≥ 1.5. The candidate-expansion logic excludes it for older zksolc.

The version-comparison helper is `isZkSolcVersionAtLeastV15` — hardcoded
threshold, no `target` parameter (all callers compare against 1.5.0). It
special-cases `vm-1.5.0-a167aa3` as <1.5 because that string is a 1.5.0
pre-release build that `semver.parse` rejects.

## Two release repos for zksolc

- **Modern (`era-compiler-solidity`):** zksolc ≥ 1.5. Release tags are bare
  versions like `1.5.16` (no `v` prefix).
- **Legacy (`zksolc-bin`):** pre-1.5 zksolc. Release tags are `v1.4.1` style
  (with `v`).

`fetchAndSaveCompiler` strips the `v` for the modern repo (default
`stripTagVersionV=true`) and keeps it for the legacy repo (`false` at the legacy
call site). `getZkSolcExecutable` tries the modern repo first, falls back to
legacy on 404.

## Linux libc: `-gnu` vs `-musl`

zksolc Linux binaries are published in two libc flavors:

- `-gnu` (glibc; Ubuntu, Debian, Fedora, RHEL, Arch — the common case)
- `-musl` (musl libc; Alpine, Void)

These are ABI-incompatible — a gnu binary won't run on a musl-only system and
vice versa. The suffix comes from Rust's target-triple convention
(`x86_64-unknown-linux-gnu` etc.), which Matter Labs uses to name release
artifacts.

`findZkSolcPlatform()` always returns `-gnu` on Linux. `getZkSolcFileNameCandidates`
then produces both `-gnu` and `-musl` filenames. `getZkSolcExecutable` tries
each in turn — on a glibc host, the gnu binary runs and we stop; on Alpine, the
gnu binary fails the `--version` check, we fall through to musl. There's no
explicit libc detection — the code just tries the binary and sees if it
executes.

**Windows note:** `findZkSolcPlatform()` returns `windows-amd64-gnu` because
Matter Labs publishes the Windows zksolc as a MinGW build (the `-gnu` suffix
here means "MinGW," not "glibc"). macOS has no libc split — single artifact per
platform.

**era-solc has no libc fallback.** The `era-solidity` repo publishes a single
Linux build under `solc-linux-amd64-<version>` with no `-gnu`/`-musl` suffix.
