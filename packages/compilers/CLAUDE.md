## Solc Compiler Internals

### soljson vs native binary

Sourcify uses two compiler paths:

- **Native binary** — invoked via `solc --standard-json`. Available from v0.4.10 (Linux), v0.3.6 (macOS), v0.4.1 (Windows).
- **soljson** — Emscripten-compiled JavaScript build. Used for all versions below the native binary thresholds. Downloaded from `binaries.soliditylang.org/bin/`.

### solc npm wrapper — C function fallback chain

For old soljsons that predate Standard JSON, the `solc` npm package (`wrapper.js`) translates Standard JSON input/output to the old format. It detects available C functions and uses the highest-priority one available:

| Priority | C function | Introduced | Input format |
|---|---|---|---|
| 1 | `solidity_compile` | v0.5.0 | Standard JSON (new libsolc API, replaces all older functions) |
| 2 | `compileStandard` | v0.4.11 | Standard JSON |
| 3 | `compileJSONCallback` | v0.2.1 | `{"sources":{"f.sol":"..."}}` + import callback |
| 4 | `compileJSONMulti` | v0.1.6 | `{"sources":{"f.sol":"..."}}` |
| 5 | `compileJSON` | v0.1.0 | Raw source string (single file only) |

Note: for v0.1.6–v0.2.0 soljsons, the wrapper lands on `compileJSONMulti` even though `compileJSON` also exists.
