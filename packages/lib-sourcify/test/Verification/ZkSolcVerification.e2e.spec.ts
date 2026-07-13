import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import {
  abstractChain,
  listFixtureLabels,
  loadFixture,
  verifyFixture,
  type ZkSyncFixture,
} from './zksync-fixtures/harness';

// End-to-end verification of native zkSync EraVM (zksolc) contracts.
//
// These tests are intentionally isolated from the rest of the suite: they
// recompile real, already-verified contracts from Abstract mainnet with zksolc
// + era-solc and match them against Abstract's public RPC. There is no local
// EraVM node (anvil-zksync exists but is archived — see the PR discussion), so
// the on-chain side is a live RPC read; the sources are committed as fixtures,
// so the block explorer is never called at test time.
//
// The suite self-skips when the Abstract RPC is unreachable (or when
// ZKSYNC_E2E=false) so offline runs / default CI stay green. It downloads
// zksolc + era-solc binaries on first run.

const ENABLED = process.env.ZKSYNC_E2E !== 'false';

const fixtures: ZkSyncFixture[] = listFixtureLabels()
  .map(loadFixture)
  // Only replay fixtures with a pinned (full) compiler version.
  .filter((f) => f.expected.compilerVersion);

describe('ZkSolcVerification (EraVM e2e, Abstract mainnet)', function () {
  before(async function () {
    if (!ENABLED) this.skip();
    // Preflight: skip the whole suite if the public RPC can't be reached, rather
    // than reporting network failures as verification failures.
    try {
      await abstractChain.getBytecode(fixtures[0].expected.address);
    } catch {
      console.warn('Abstract RPC unreachable — skipping zksolc e2e tests');
      this.skip();
    }
  });

  it('captured at least one keccak (≤1.5.12) and one CBOR (≥1.5.13) fixture', () => {
    const zksolcVersions = fixtures.map(
      (f) => f.expected.explorerZkSolcVersion,
    );
    expect(zksolcVersions.some((v) => v === 'v1.5.7')).to.equal(true);
    expect(zksolcVersions.some((v) => v === 'v1.5.15')).to.equal(true);
  });

  for (const fixture of fixtures) {
    const { label, expected } = fixture;
    describe(`${label} [${expected.compilerVersion}]`, () => {
      it(`runtimeMatch=${expected.expectedRuntimeMatch}, creationMatch=${expected.expectedCreationMatch}`, async () => {
        const verification = await verifyFixture(
          expected,
          fixture.input,
          expected.compilerVersion as string,
        );

        expect(verification.status.runtimeMatch).to.equal(
          expected.expectedRuntimeMatch,
        );
        expect(verification.status.creationMatch).to.equal(
          expected.expectedCreationMatch,
        );
      });
    });
  }
});
