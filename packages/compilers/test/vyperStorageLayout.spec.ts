import { expect } from 'chai';
import path from 'path';
import { useVyperCompiler } from '../src/lib/vyperCompiler';
import {
  normalizeVyperStorageLayout,
  normalizeVyperTransientStorageLayout,
  normalizeVyperVersionForPython,
  repairDuplicatedVyperHashMapType,
  runIsolatedVyper,
  supportsHistoricalVyperStorageLayout,
  useVyperStorageLayout,
  useVyperStorageLayouts,
} from '../src/lib/vyperStorageLayout';

describe('Vyper storage layout helpers', () => {
  it('normalizes Sourcify release names for PyPI', () => {
    expect(
      normalizeVyperVersionForPython('0.1.0-beta.16+commit.5e4a94a'),
    ).to.equal('0.1.0b16');
    expect(normalizeVyperVersionForPython('0.4.1b3+commit.537313b0')).to.equal(
      '0.4.1b3',
    );
    expect(normalizeVyperVersionForPython('0.2.0+commit.a7f14fe')).to.equal(
      '0.2.1',
    );
  });

  it('uses the real Standard JSON layout boundary', () => {
    expect(
      supportsHistoricalVyperStorageLayout('0.1.0-beta.16+commit.5e4a94a'),
    ).to.equal(true);
    expect(
      supportsHistoricalVyperStorageLayout('0.4.1b3+commit.537313b0'),
    ).to.equal(true);
    expect(
      supportsHistoricalVyperStorageLayout('0.4.1b4+commit.4507d2a6'),
    ).to.equal(false);
    expect(
      supportsHistoricalVyperStorageLayout('0.4.1rc1+commit.4f7e6b3'),
    ).to.equal(false);
  });

  it('repairs nested duplicated historical HashMap renderings', () => {
    expect(
      repairDuplicatedVyperHashMapType(
        'HashMap[address, HashMap[address, uint256][address, uint256]][address, HashMap[address, uint256][address, uint256]]',
      ),
    ).to.equal('HashMap[address, HashMap[address, uint256]]');
  });

  it('normalizes flat, wrapped, and namespaced layouts by slot', () => {
    expect(
      normalizeVyperStorageLayout({
        storage_layout: {
          module: {
            type: { type: 'address', slot: 2, n_slots: 1 },
            slot: { type: 'uint256', slot: 1, n_slots: 1 },
          },
          owner: { type: 'address', slot: 0, n_slots: 1 },
        },
        code_layout: {},
      }),
    ).to.deep.equal({
      owner: { type: 'address', slot: 0, n_slots: 1 },
      'module.slot': { type: 'uint256', slot: 1, n_slots: 1 },
      'module.type': { type: 'address', slot: 2, n_slots: 1 },
    });
  });

  it('normalizes an immutable-only native layout to empty storage', () => {
    expect(
      normalizeVyperStorageLayout({
        code_layout: {
          OWNER: { type: 'address', offset: 0, length: 32 },
        },
      }),
    ).to.deep.equal({});
  });

  it('normalizes Vyper transient storage independently', () => {
    expect(
      normalizeVyperTransientStorageLayout({
        storage_layout: {
          persistent_value: { type: 'uint256', slot: 0, n_slots: 1 },
        },
        transient_storage_layout: {
          temporary_value: { type: 'uint256', slot: 1, n_slots: 1 },
        },
      }),
    ).to.deep.equal({
      temporary_value: { type: 'uint256', slot: 1, n_slots: 1 },
    });
    expect(
      normalizeVyperTransientStorageLayout({ storage_layout: {} }),
    ).to.equal(undefined);
  });

  it('rejects a layout whose span could not be recovered', () => {
    expect(() =>
      normalizeVyperStorageLayout({
        values: { type: 'uint256[3]', slot: 0 },
      }),
    ).to.throw('Invalid Vyper storage layout n_slots');
  });

  it('preserves storage variables whose names resemble layout metadata', () => {
    expect(
      normalizeVyperStorageLayout({
        storage_layout: { type: 'bytes32', slot: 0, n_slots: 1 },
        code_layout: { type: 'uint256', slot: 1, n_slots: 1 },
        transient_storage_layout: { type: 'address', slot: 2, n_slots: 1 },
        type_definitions: { type: 'bool', slot: 3, n_slots: 1 },
      }),
    ).to.deep.equal({
      storage_layout: { type: 'bytes32', slot: 0, n_slots: 1 },
      code_layout: { type: 'uint256', slot: 1, n_slots: 1 },
      transient_storage_layout: { type: 'address', slot: 2, n_slots: 1 },
      type_definitions: { type: 'bool', slot: 3, n_slots: 1 },
    });
  });

  it('rejects coerced null and empty storage positions', () => {
    for (const slot of [null, '']) {
      expect(() =>
        normalizeVyperStorageLayout({
          value: { type: 'uint256', slot, n_slots: 1 },
        }),
      ).to.throw('Invalid Vyper storage layout slot');
    }
  });

  it('attaches validated structured type definitions to flat entries', () => {
    const layout = normalizeVyperStorageLayout(
      {
        pair: { type: 'Pair', slot: 0, n_slots: 2 },
        owner: { type: 'address', slot: 2, n_slots: 1 },
      },
      {
        Pair: {
          members: [
            { name: 'left', type: 'uint256', slot: 0, n_slots: 1 },
            { name: 'right', type: 'address', slot: 1, n_slots: 1 },
          ],
          n_slots: 2,
        },
      },
    );
    expect(layout.pair.type_definitions).to.deep.equal({
      Pair: {
        members: [
          { name: 'left', type: 'uint256', slot: 0, n_slots: 1 },
          { name: 'right', type: 'address', slot: 1, n_slots: 1 },
        ],
        n_slots: 2,
      },
    });
    expect(layout.owner.type_definitions).to.equal(undefined);
  });
});

const describeCompilerMatrix =
  process.env.VYPER_LAYOUT_COMPILER_TESTS === '1' ? describe : describe.skip;

describeCompilerMatrix(
  'historical Vyper storage layout compiler matrix',
  () => {
    const vyperRepoPath = path.join('/tmp', 'compilers-vyper-layout-repo');

    for (const [version, mappingType, expectedArraySlots] of [
      ['0.1.0-beta.16', 'map(address, uint256)', 1],
      ['0.2.0', 'HashMap[address, uint256]', 1],
      ['0.2.12', 'HashMap[address, uint256]', 1],
      ['0.2.14', 'HashMap[address, uint256]', 3],
      ['0.2.15', 'HashMap[address, uint256]', 3],
      ['0.2.16', 'HashMap[address, uint256]', 3],
      ['0.3.2', 'HashMap[address, uint256]', 3],
      ['0.4.0', 'HashMap[address, uint256]', 3],
      ['0.4.1b3', 'HashMap[address, uint256]', 3],
    ] as const) {
      it(`extracts the compiler-assigned ${version} layout`, async function () {
        this.timeout(5 * 60 * 1000);
        const source = `owner: address
balances: ${mappingType}
values: uint256[3]
`;
        const layout = await useVyperStorageLayout(
          vyperRepoPath,
          version,
          {
            language: 'Vyper',
            sources: { 'Fixture.vy': { content: source } },
            settings: { outputSelection: { 'Fixture.vy': [] } },
          },
          'Fixture.vy',
        );
        expect(layout.owner).to.deep.equal({
          type: 'address',
          slot: 0,
          n_slots: 1,
        });
        expect(layout.balances).to.deep.equal({
          type: 'HashMap[address, uint256]',
          slot: 1,
          n_slots: 1,
        });
        expect(layout.values).to.deep.equal({
          type: 'uint256[3]',
          slot: 2,
          n_slots: expectedArraySlots,
        });
      });
    }

    it('preserves nested HashMap key/value order and repairs type rendering', async function () {
      this.timeout(5 * 60 * 1000);
      const layout = await useVyperStorageLayout(
        vyperRepoPath,
        '0.2.16',
        {
          language: 'Vyper',
          sources: {
            'Fixture.vy': {
              content:
                'balances: HashMap[address, HashMap[address, uint256]]\n',
            },
          },
          settings: { outputSelection: { 'Fixture.vy': [] } },
        },
        'Fixture.vy',
      );
      expect(layout.balances.type).to.equal(
        'HashMap[address, HashMap[address, uint256]]',
      );
    });

    for (const version of ['0.3.8', '0.4.0'] as const) {
      it(`extracts Vyper ${version} transient storage layout`, async function () {
        this.timeout(5 * 60 * 1000);
        const layouts = await useVyperStorageLayouts(
          vyperRepoPath,
          version,
          {
            language: 'Vyper',
            sources: {
              'Fixture.vy': {
                content:
                  'persistent_value: uint256\ntemporary_value: transient(uint256)\n',
              },
            },
            settings: {
              evmVersion: 'cancun',
              outputSelection: { 'Fixture.vy': [] },
            },
          },
          'Fixture.vy',
        );
        expect(layouts.storageLayout).to.deep.equal({
          persistent_value: { type: 'uint256', slot: 0, n_slots: 1 },
        });
        expect(layouts.transientStorageLayout).to.deep.equal({
          temporary_value: { type: 'uint256', slot: 1, n_slots: 1 },
        });
      });
    }

    for (const version of ['0.4.0b1', '0.4.0rc5'] as const) {
      it(`recovers spans omitted by the native ${version} layout`, async function () {
        this.timeout(5 * 60 * 1000);
        const layouts = await useVyperStorageLayouts(
          vyperRepoPath,
          version,
          {
            language: 'Vyper',
            sources: {
              'Fixture.vy': {
                content:
                  'owner: address\nbalances: HashMap[address, uint256]\nvalues: uint256[3]\n',
              },
            },
            settings: { outputSelection: { 'Fixture.vy': [] } },
          },
          'Fixture.vy',
        );
        const layout = layouts.storageLayout;
        expect(layout.values.n_slots).to.equal(3);
        expect(layout.balances.n_slots).to.equal(1);
        if (version === '0.4.0b1') {
          expect(layout['$.nonreentrant_key'].n_slots).to.equal(1);
        } else {
          expect(layouts.transientStorageLayout).to.not.equal(undefined);
          expect(Object.keys(layouts.transientStorageLayout || {})).to.not.be
            .empty;
          expect(
            Object.values(layouts.transientStorageLayout || {}).every(
              ({ n_slots }) => n_slots === 1,
            ),
          ).to.equal(true);
        }
      });
    }

    for (const version of [
      '0.2.12',
      '0.2.15',
      '0.2.16',
      '0.3.2',
      '0.4.0',
      '0.4.1b3',
    ] as const) {
      it(`preserves structured type definitions in ${version}`, async function () {
        this.timeout(5 * 60 * 1000);
        const layout = await useVyperStorageLayout(
          vyperRepoPath,
          version,
          {
            language: 'Vyper',
            sources: {
              'Fixture.vy': {
                content: `struct Pair:
    left: uint256
    right: address

pair: Pair
pairs: Pair[2]
by_owner: HashMap[address, Pair]
`,
              },
            },
            settings: { outputSelection: { 'Fixture.vy': [] } },
          },
          'Fixture.vy',
        );
        expect(layout.by_owner.type).to.equal('HashMap[address, Pair]');
        expect(layout.by_owner.type_definitions?.Pair).to.deep.equal({
          members: [
            { name: 'left', type: 'uint256', slot: 0, n_slots: 1 },
            { name: 'right', type: 'address', slot: 1, n_slots: 1 },
          ],
          n_slots: 2,
        });
        expect(layout.pairs.type_definitions?.Pair).to.deep.equal({
          members: [
            { name: 'left', type: 'uint256', slot: 0, n_slots: 1 },
            { name: 'right', type: 'address', slot: 1, n_slots: 1 },
          ],
          n_slots: 2,
        });
      });
    }

    for (const version of ['0.4.0', '0.4.1b3'] as const) {
      it(`preserves initialized-module struct definitions in ${version}`, async function () {
        this.timeout(5 * 60 * 1000);
        const layout = await useVyperStorageLayout(
          vyperRepoPath,
          version,
          {
            language: 'Vyper',
            sources: {
              'Main.vy': {
                content:
                  'import lib\nimport other\n\ninitializes: lib\ninitializes: other\n',
              },
              'lib.vy': {
                content: `struct Pair:
    left: uint256
    right: address

pair: Pair
pairs: Pair[2]
by_owner: HashMap[address, Pair]
`,
              },
              'other.vy': {
                content: `struct Pair:
    digest: bytes32
    enabled: bool

pair: Pair
`,
              },
            },
            settings: { outputSelection: { 'Main.vy': [] } },
          },
          'Main.vy',
        );
        expect(layout['lib.pair']).to.deep.equal({
          type: 'Pair',
          slot: 0,
          n_slots: 2,
          type_definitions: {
            Pair: {
              members: [
                { name: 'left', type: 'uint256', slot: 0, n_slots: 1 },
                { name: 'right', type: 'address', slot: 1, n_slots: 1 },
              ],
              n_slots: 2,
            },
          },
        });
        expect(layout['lib.pairs'].type).to.equal('Pair[2]');
        expect(layout['lib.pairs'].n_slots).to.equal(4);
        expect(layout['lib.by_owner'].type).to.equal('HashMap[address, Pair]');
        expect(
          layout['other.pair'].type_definitions?.Pair.members,
        ).to.deep.equal([
          { name: 'digest', type: 'bytes32', slot: 0, n_slots: 1 },
          { name: 'enabled', type: 'bool', slot: 1, n_slots: 1 },
        ]);
      });
    }

    it('scopes colliding imported struct definitions to target leaves', async function () {
      this.timeout(5 * 60 * 1000);
      const layout = await useVyperStorageLayout(
        vyperRepoPath,
        '0.4.0',
        {
          language: 'Vyper',
          sources: {
            'Main.vy': {
              content:
                'import lib\nimport other\n\nleft: lib.Pair\nright: other.Pair\n',
            },
            'lib.vy': {
              content: 'struct Pair:\n    left: uint256\n',
            },
            'other.vy': {
              content: 'struct Pair:\n    right: address\n',
            },
          },
          settings: { outputSelection: { 'Main.vy': [] } },
        },
        'Main.vy',
      );
      expect(layout.left.type).to.equal('Pair');
      expect(layout.right.type).to.equal('Pair');
      expect(layout.left.type_definitions?.Pair.members).to.deep.equal([
        { name: 'left', type: 'uint256', slot: 0, n_slots: 1 },
      ]);
      expect(layout.right.type_definitions?.Pair.members).to.deep.equal([
        { name: 'right', type: 'address', slot: 0, n_slots: 1 },
      ]);
    });

    it('qualifies colliding imported structs reachable from one leaf', async function () {
      this.timeout(5 * 60 * 1000);
      const layout = await useVyperStorageLayout(
        vyperRepoPath,
        '0.4.0',
        {
          language: 'Vyper',
          sources: {
            'Main.vy': {
              content: `import lib
import other

struct Both:
    left: lib.Pair
    right: other.Pair

both: Both
`,
            },
            'lib.vy': {
              content: 'struct Pair:\n    left: uint256\n',
            },
            'other.vy': {
              content: 'struct Pair:\n    right: address\n',
            },
          },
          settings: { outputSelection: { 'Main.vy': [] } },
        },
        'Main.vy',
      );
      const definitions = layout.both.type_definitions!;
      const members = definitions.Both.members;
      expect(members[0].type).to.equal('Pair');
      expect(members[1].type).to.match(/^Pair\$[0-9a-f]{64}$/);
      expect(definitions.Pair.members).to.deep.equal([
        { name: 'left', type: 'uint256', slot: 0, n_slots: 1 },
      ]);
      expect(definitions[members[1].type].members).to.deep.equal([
        { name: 'right', type: 'address', slot: 0, n_slots: 1 },
      ]);
    });

    it('preserves the 0.2.14 compiler-assigned lock collision', async function () {
      this.timeout(5 * 60 * 1000);
      const layout = await useVyperStorageLayout(
        vyperRepoPath,
        '0.2.14',
        {
          language: 'Vyper',
          sources: {
            'Fixture.vy': {
              content: `owner: address

@external
@nonreentrant("lock")
def set_owner(new_owner: address):
    self.owner = new_owner
`,
            },
          },
          settings: { outputSelection: { 'Fixture.vy': [] } },
        },
        'Fixture.vy',
      );
      expect(layout.owner.slot).to.equal(0);
      expect(layout['nonreentrant.lock'].slot).to.equal(1);
    });

    it('terminates isolated compiler processes on timeout and output overflow', async function () {
      this.timeout(30 * 1000);
      const previousTimeout = process.env.VYPER_PROCESS_TIMEOUT_MS;
      process.env.VYPER_PROCESS_TIMEOUT_MS = '100';
      try {
        let timeoutError: unknown;
        try {
          await runIsolatedVyper(
            vyperRepoPath,
            '0.3.2',
            ['python', '-c', 'import time; time.sleep(30)'],
            '',
            1024,
          );
        } catch (error) {
          timeoutError = error;
        }
        expect((timeoutError as Error)?.message).to.contain('timed out');
      } finally {
        if (previousTimeout === undefined) {
          delete process.env.VYPER_PROCESS_TIMEOUT_MS;
        } else {
          process.env.VYPER_PROCESS_TIMEOUT_MS = previousTimeout;
        }
      }

      let outputError: unknown;
      try {
        await runIsolatedVyper(
          vyperRepoPath,
          '0.3.2',
          ['python', '-c', 'print("x" * 4096)'],
          '',
          64,
        );
      } catch (error) {
        outputError = error;
      }
      expect((outputError as Error)?.message).to.contain(
        'output size too large',
      );
    });

    for (const [version, expectedSlots] of [
      ['0.2.12', 1],
      ['0.2.15', 5],
      ['0.3.2', 4],
    ] as const) {
      it(`preserves the ${version} Bytes[65] allocator span`, async function () {
        this.timeout(5 * 60 * 1000);
        const layout = await useVyperStorageLayout(
          vyperRepoPath,
          version,
          {
            language: 'Vyper',
            sources: { 'Fixture.vy': { content: 'data: Bytes[65]\n' } },
            settings: { outputSelection: { 'Fixture.vy': [] } },
          },
          'Fixture.vy',
        );
        expect(layout.data.n_slots).to.equal(expectedSlots);
      });
    }

    it('compiles a release with no GitHub binary through the Python fallback', async function () {
      this.timeout(5 * 60 * 1000);
      const output = await useVyperCompiler(vyperRepoPath, '0.2.14', {
        language: 'Vyper',
        sources: {
          'Fixture.vy': {
            content: '@external\ndef answer() -> uint256:\n    return 42\n',
          },
        },
        settings: {
          outputSelection: {
            'Fixture.vy': ['evm.bytecode.object'],
          },
        },
      });
      expect(
        output.contracts['Fixture.vy'].Fixture.evm.bytecode.object,
      ).to.match(/^0x[0-9a-f]+$/i);
    });
  },
);
