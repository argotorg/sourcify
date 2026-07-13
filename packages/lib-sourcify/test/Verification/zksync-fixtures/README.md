# zksolc / EraVM verification fixtures

Fixtures for the end-to-end `ZkSolcVerification` tests
(`../ZkSolcVerification.spec.ts`). Each subdirectory is one already-verified
native EraVM contract from **Abstract mainnet** (chainId 2741):

- `input.json` — the Solidity standard-JSON compiler input (captured from the
  block explorer).
- `expected.json` — address, creation tx, the resolved
  `zksolc:<v>;solc:<v>` compiler version, and the expected runtime/creation
  match statuses.

The spec recompiles each contract with zksolc + era-solc and matches it against
Abstract's **public RPC**. There is no local EraVM node in the loop (anvil-zksync
exists but is archived), so the on-chain side is a live RPC read; the sources
are committed here so the block explorer is never called at test time. The suite
self-skips when the RPC is unreachable or when `ZKSYNC_E2E=false`.

## Adding fixtures

Each fixture was captured from an already-verified contract on the Abstract
block explorer (Etherscan V2 multichain API, `chainid=2741`), keeping only
genuine zksolc contracts (`ZkSolcVersion != v0.0.0`):

- `input.json` is the explorer's standard-JSON compiler input verbatim.
- `expected.json` records the address, creation tx, constructor args, the full
  `zksolc:<v>;solc:<v>` compiler version (with the era-solc edition, e.g.
  `0.8.24-1.0.2`), and the expected match statuses.

The explorer reports the solc half without its era-solc edition
(`v0.8.24+commit…`); resolve the edition (try `-1.0.2`, `-1.0.1`, `-1.0.0`) when
capturing a fixture and store the full composite version. To add one, capture
those fields for a verified contract, then run the spec once to confirm the
recorded `expectedRuntimeMatch` / `expectedCreationMatch` hold.

## What the current set covers

- **zksolc version span:** legacy pre-1.5.0 builds (`1.3.8`, `1.3.18`, `1.4.1`)
  that exercise the `matter-labs/zksolc-bin` fallback download repo and the
  pre-1.5.0 CLI/output-selection path, the first `1.5.0` build, and the modern
  `1.5.x` line up to the `v1.5.15` fixtures.
- **Metadata encodings:** keccak256 (zksolc ≤ 1.5.12, e.g. `NftMarketSystem`,
  `GlueFactorySystem`) and CBOR (≥ 1.5.13, the `v1.5.15` fixtures).
- **era-solc edition:** explicit in the explorer (`0.8.24-1.0.2`,
  `0.8.28-1.0.1`) and resolved from a commit-form version by candidate expansion.
- **Constructor arguments:** present and absent.
- **Creation matching:** direct ContractDeployer deploys that match
  (`creationMatch: perfect`), a partial-runtime keccak contract that therefore
  cannot creation-match (`null` — the versioned bytecode hash is all-or-nothing),
  and a batch/factory deploy whose creation tx isn't this contract (`null`).

**Known gaps (not present on Abstract in the sampled listing):** contracts using
linked libraries and metadata-disabled builds.
