import { describe, it } from 'mocha';
import { expect } from 'chai';
import type { SolidityJsonInput } from '@ethereum-sourcify/compilers-types';
import { normalizeLegacyLinkReferences } from '../../src/Compilation/legacyLinkReferences';

const ADDRESS = '1111111111111111111111111111111111111111';

function placeholder(label: string) {
  return '__' + label.slice(0, 36).padEnd(36, '_') + '__';
}

function jsonInput(
  sources: Record<string, string>,
  settings: SolidityJsonInput['settings'] = {},
): SolidityJsonInput {
  return {
    language: 'Solidity',
    sources: Object.fromEntries(
      Object.entries(sources).map(([path, content]) => [path, { content }]),
    ),
    settings,
  };
}

const SOURCES = {
  'contracts/Consumer.sol':
    'import "libraries/Lib.sol";\ncontract Consumer { }',
  'libraries/Lib.sol': 'library Lib { }',
};

describe('normalizeLegacyLinkReferences', () => {
  it('returns standard JSON link references unchanged', () => {
    const linkReferences = {
      'libraries/Lib.sol': { Lib: [{ start: 1, length: 20 }] },
    };
    expect(
      normalizeLegacyLinkReferences(
        linkReferences as any,
        '60' + placeholder('Lib'),
        jsonInput(SOURCES),
      ),
    ).to.deep.equal(linkReferences);
    expect(
      normalizeLegacyLinkReferences(undefined, '', jsonInput(SOURCES)),
    ).to.equal(undefined);
    expect(
      normalizeLegacyLinkReferences({}, '', jsonInput(SOURCES)),
    ).to.deep.equal({});
  });

  it('resolves a bare-name placeholder (solc < 0.4.9) to the declaring file', () => {
    const bytecode = '60' + placeholder('Lib') + '60' + placeholder('Lib');
    const normalized = normalizeLegacyLinkReferences(
      { Lib: [{ start: 1, length: 20 }] } as any,
      bytecode,
      jsonInput(SOURCES),
    );
    expect(normalized).to.deep.equal({
      'libraries/Lib.sol': {
        Lib: [
          { start: 1, length: 20 },
          { start: 22, length: 20 },
        ],
      },
    });
  });

  it('prefers the file given in settings.libraries', () => {
    const normalized = normalizeLegacyLinkReferences(
      { Lib: [{ start: 1, length: 20 }] } as any,
      '60' + placeholder('Lib'),
      jsonInput(SOURCES, {
        libraries: { 'other/Path.sol': { Lib: '0x' + ADDRESS } },
      }),
    );
    expect(normalized).to.deep.equal({
      'other/Path.sol': { Lib: [{ start: 1, length: 20 }] },
    });
  });

  it('resolves a file:Lib placeholder (solc 0.4.9)', () => {
    const normalized = normalizeLegacyLinkReferences(
      { 'libraries/Lib.sol:Lib': [{ start: 1, length: 20 }] } as any,
      '60' + placeholder('libraries/Lib.sol:Lib'),
      jsonInput(SOURCES),
    );
    expect(normalized).to.deep.equal({
      'libraries/Lib.sol': { Lib: [{ start: 1, length: 20 }] },
    });
  });

  it('resolves a truncated file:Lib placeholder', () => {
    const file = 'contracts/libraries/accounting/AccountingLib.sol';
    const label = `${file}:AccountingLib`.slice(0, 36);
    expect(label).to.not.include(':');
    const normalized = normalizeLegacyLinkReferences(
      { [label]: [{ start: 1, length: 20 }] } as any,
      '60' + placeholder(label),
      jsonInput({ [file]: 'library AccountingLib { }' }),
    );
    expect(normalized).to.deep.equal({
      [file]: { AccountingLib: [{ start: 1, length: 20 }] },
    });
  });

  it('resolves a library name with trailing underscores', () => {
    const normalized = normalizeLegacyLinkReferences(
      { Oracle: [{ start: 1, length: 20 }] } as any,
      '60' + placeholder('Oracle_'),
      jsonInput({ 'Oracle.sol': 'library Oracle_ { }' }),
    );
    expect(normalized).to.deep.equal({
      'Oracle.sol': { Oracle_: [{ start: 1, length: 20 }] },
    });
  });

  it('ignores library names in comments and string literals', () => {
    const normalized = normalizeLegacyLinkReferences(
      { Lib: [{ start: 1, length: 20 }] } as any,
      '60' + placeholder('Lib'),
      jsonInput({
        'contracts/Consumer.sol':
          '// uses library Lib for math\n/* library Lib */\ncontract Consumer { string s = "library Lib"; }',
        'libraries/Lib.sol': 'library Lib { }',
      }),
    );
    expect(normalized).to.deep.equal({
      'libraries/Lib.sol': { Lib: [{ start: 1, length: 20 }] },
    });
  });

  it('ignores the positions of the legacy map', () => {
    // Linked positions and phantom entries of solc-js are not placeholders
    const bytecode =
      '73' + ADDRESS + '73' + placeholder('Lib') + '73' + placeholder('Lib');
    const normalized = normalizeLegacyLinkReferences(
      {
        Lib: [
          { start: 1, length: 20 },
          { start: 22, length: 20 },
        ],
        ______________________73__Lib_______: [{ start: 32, length: 20 }],
      } as any,
      bytecode,
      jsonInput(SOURCES),
    );
    expect(normalized).to.deep.equal({
      'libraries/Lib.sol': {
        Lib: [
          { start: 22, length: 20 },
          { start: 43, length: 20 },
        ],
      },
    });
    expect(
      normalizeLegacyLinkReferences(
        { Lib: [{ start: 1, length: 20 }] } as any,
        '73' + ADDRESS,
        jsonInput(SOURCES),
      ),
    ).to.deep.equal({});
  });

  it('falls back to the label with an empty file for an unknown library', () => {
    const normalized = normalizeLegacyLinkReferences(
      { Unknown: [{ start: 1, length: 20 }] } as any,
      '60' + placeholder('Unknown') + '60' + placeholder('dir/File.sol:Other'),
      jsonInput(SOURCES),
    );
    expect(normalized).to.deep.equal({
      '': { Unknown: [{ start: 1, length: 20 }] },
      'dir/File.sol': { Other: [{ start: 22, length: 20 }] },
    });
  });

  it('does not treat special property names differently', () => {
    const normalized = normalizeLegacyLinkReferences(
      { constructor: [{ start: 1, length: 20 }] } as any,
      '60' + placeholder('constructor') + '60' + placeholder('__proto__'),
      // An object literal with a `__proto__` key sets the prototype instead
      jsonInput(
        Object.fromEntries([
          ['__proto__', 'library constructor { }'],
          ['b.sol', 'library __proto__ { }'],
        ]),
      ),
    );
    expect(Object.keys(normalized!)).to.deep.equal(['__proto__', 'b.sol']);
    expect(Object.getPrototypeOf(normalized)).to.equal(Object.prototype);
    expect(Object.keys(normalized!['b.sol'])).to.deep.equal(['__proto__']);
    expect(Object.getPrototypeOf(normalized!['b.sol'])).to.equal(
      Object.prototype,
    );
    expect(normalized!['b.sol']['__proto__']).to.deep.equal([
      { start: 22, length: 20 },
    ]);
  });
});
