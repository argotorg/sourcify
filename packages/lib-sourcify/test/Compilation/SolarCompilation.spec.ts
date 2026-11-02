import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  SolarCompilation,
  flattenSolarCborAuxdata,
} from '../../src/Compilation/SolarCompilation';
import { CompilationError } from '../../src/Compilation/CompilationTypes';
import { solarCompiler } from '../utils';

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
