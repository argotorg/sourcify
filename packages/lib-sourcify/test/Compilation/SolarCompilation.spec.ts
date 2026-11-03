import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  SolarCompilation,
  flattenSolarCborAuxdata,
} from '../../src/Compilation/SolarCompilation';
import { CompilationError } from '../../src/Compilation/CompilationTypes';
import type { ISolarCompiler } from '../../src/Compilation/CompilationTypes';
import type { SolarOutput } from '@ethereum-sourcify/compilers-types';
import { solarCompiler } from '../utils';

// A compiler that returns a minimal output with the given metadata version
function fakeCompiler(metadataVersion: string): ISolarCompiler {
  return {
    compile: async () =>
      ({
        contracts: {
          'A.sol': {
            A: {
              metadata: JSON.stringify({
                compiler: { name: 'solar', version: metadataVersion },
              }),
              evm: {
                bytecode: { object: '6000', linkReferences: {} },
                deployedBytecode: { object: '6000', linkReferences: {} },
              },
            },
          },
        },
      }) as unknown as SolarOutput,
  };
}

describe('SolarCompilation', () => {
  it('should number the auxdata trailers by offset', () => {
    expect(
      flattenSolarCborAuxdata({
        'A.sol:Child': [
          { offset: 40, value: '0xaa' },
          { offset: 120, value: '0xaa' },
        ],
        'A.sol:C': [{ offset: 80, value: '0xcc' }],
      }),
    ).to.deep.equal({
      '1': { offset: 40, value: '0xaa' },
      '2': { offset: 80, value: '0xcc' },
      '3': { offset: 120, value: '0xaa' },
    });
  });

  it('should list a trailer shared by several contracts once', () => {
    // With bytecodeHash none, identical contracts share one trailer
    expect(
      flattenSolarCborAuxdata({
        'A.sol:A': [{ offset: 10, value: '0xbb' }],
        'A.sol:B': [{ offset: 10, value: '0xbb' }],
      }),
    ).to.deep.equal({ '1': { offset: 10, value: '0xbb' } });
  });

  it('should return no trailers when the output has none', () => {
    expect(flattenSolarCborAuxdata({})).to.deep.equal({});
  });

  it('should fail when the compiler does not report the trailers', () => {
    expect(() => flattenSolarCborAuxdata(undefined))
      .to.throw(CompilationError)
      .with.property('code', 'cannot_generate_cbor_auxdata_positions');
  });

  it('should store the version that the metadata reports', async () => {
    const compilation = new SolarCompilation(
      fakeCompiler('0.8.38+commit.e7a91fc7.solar.0.3.0'),
      // Same build, another solc part
      '0.8.36+commit.e7a91fc7.solar.0.3.0',
      { language: 'Solidity', sources: {}, settings: {} },
      { path: 'A.sol', name: 'A' },
    );
    await compilation.compile();
    expect(compilation.compilerVersion).to.equal(
      '0.8.38+commit.e7a91fc7.solar.0.3.0',
    );
  });

  it('should reject a build whose metadata does not name a Solar version', async () => {
    const compilation = new SolarCompilation(
      fakeCompiler('0.8.28+commit.7893614a'),
      '0.8.38+commit.e7a91fc7.solar.0.3.0',
      { language: 'Solidity', sources: {}, settings: {} },
      { path: 'A.sol', name: 'A' },
    );
    try {
      await compilation.compile();
      expect.fail('Expected error was not thrown');
    } catch (error: any) {
      expect(error).to.be.instanceOf(CompilationError);
      expect(error.code).to.equal('invalid_compiler_version');
    }
  });

  it('should reject a solc version', () => {
    expect(
      () =>
        new SolarCompilation(
          solarCompiler,
          '0.8.28+commit.7893614a',
          { language: 'Solidity', sources: {}, settings: {} },
          { path: 'A.sol', name: 'A' },
        ),
    )
      .to.throw(CompilationError)
      .with.property('code', 'invalid_compiler_version');
  });
});
