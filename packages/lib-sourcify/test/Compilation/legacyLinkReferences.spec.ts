import { describe, it } from 'mocha';
import { expect } from 'chai';
import type { SolidityJsonInput } from '@ethereum-sourcify/compilers-types';
import { normalizeLegacyLinkReferences } from '../../src/Compilation/legacyLinkReferences';

const PLACEHOLDER = '__Lib___________________________________';
const ADDRESS = '1111111111111111111111111111111111111111';

function jsonInput(
  settings: SolidityJsonInput['settings'] = {},
): SolidityJsonInput {
  return {
    language: 'Solidity',
    sources: {
      'contracts/Consumer.sol': {
        content: 'import "libraries/Lib.sol";\ncontract Consumer {}',
      },
      'libraries/Lib.sol': { content: 'library Lib { }' },
    },
    settings,
  };
}

describe('normalizeLegacyLinkReferences', () => {
  it('returns standard JSON link references unchanged', () => {
    const linkReferences = {
      'libraries/Lib.sol': { Lib: [{ start: 1, length: 20 }] },
    };
    expect(
      normalizeLegacyLinkReferences(
        linkReferences as any,
        '60' + PLACEHOLDER,
        jsonInput(),
      ),
    ).to.deep.equal(linkReferences);
    expect(normalizeLegacyLinkReferences(undefined, '', jsonInput())).to.equal(
      undefined,
    );
  });

  it('finds the file of a bare library name in the sources', () => {
    const bytecode = '60' + PLACEHOLDER + '60' + PLACEHOLDER;
    const normalized = normalizeLegacyLinkReferences(
      {
        Lib: [
          { start: 1, length: 20 },
          { start: 22, length: 20 },
        ],
      } as any,
      bytecode,
      jsonInput(),
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
      '60' + PLACEHOLDER,
      jsonInput({ libraries: { 'other/Path.sol': { Other: '0x' + ADDRESS } } }),
    );
    expect(normalized).to.deep.equal({
      'libraries/Lib.sol': { Lib: [{ start: 1, length: 20 }] },
    });
    const normalizedWithFile = normalizeLegacyLinkReferences(
      { Lib: [{ start: 1, length: 20 }] } as any,
      '60' + PLACEHOLDER,
      jsonInput({ libraries: { 'other/Path.sol': { Lib: '0x' + ADDRESS } } }),
    );
    expect(normalizedWithFile).to.deep.equal({
      'other/Path.sol': { Lib: [{ start: 1, length: 20 }] },
    });
  });

  it('splits a file:Lib label (solc 0.4.9)', () => {
    const normalized = normalizeLegacyLinkReferences(
      { 'libraries/Lib.sol:Lib': [{ start: 1, length: 20 }] } as any,
      '60' + '__libraries/Lib.sol:Lib_________________',
      jsonInput(),
    );
    expect(normalized).to.deep.equal({
      'libraries/Lib.sol': { Lib: [{ start: 1, length: 20 }] },
    });
  });

  it('drops positions that solc-js linked already', () => {
    const bytecode = '60' + ADDRESS + '60' + PLACEHOLDER;
    const normalized = normalizeLegacyLinkReferences(
      {
        Lib: [
          { start: 1, length: 20 },
          { start: 22, length: 20 },
        ],
      } as any,
      bytecode,
      jsonInput(),
    );
    expect(normalized).to.deep.equal({
      'libraries/Lib.sol': { Lib: [{ start: 22, length: 20 }] },
    });
    expect(
      normalizeLegacyLinkReferences(
        { Lib: [{ start: 1, length: 20 }] } as any,
        '60' + ADDRESS,
        jsonInput(),
      ),
    ).to.deep.equal({});
  });

  it('uses an empty file when the library is not declared in the sources', () => {
    const normalized = normalizeLegacyLinkReferences(
      { Unknown: [{ start: 1, length: 20 }] } as any,
      '60' + '__Unknown_______________________________',
      jsonInput(),
    );
    expect(normalized).to.deep.equal({
      '': { Unknown: [{ start: 1, length: 20 }] },
    });
  });
});
