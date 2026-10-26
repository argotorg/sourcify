import { expect } from 'chai';
import { describe, it } from 'mocha';
import { id as keccak256Str } from 'ethers';
import {
  extractCallProtectionTransformation,
  extractLibrariesTransformation,
} from '../../src/Verification/Transformations';
import type { LinkReferences } from '@ethereum-sourcify/compilers-types';

const ADDRESS_A = '1111111111111111111111111111111111111111';
const ADDRESS_B = '2222222222222222222222222222222222222222';
const ZERO_ADDRESS = '00'.repeat(20);

describe('extractCallProtectionTransformation', () => {
  const tail = '60806040';
  const guardTemplate = `0x73${ZERO_ADDRESS}3014${tail}`;
  const guardOnchain = `0x73${ADDRESS_A}3014${tail}`;

  it('replaces the library guard address for Solidity', () => {
    const result = extractCallProtectionTransformation(
      guardTemplate,
      guardOnchain,
      'Solidity',
    );
    expect(result.populatedRecompiledBytecode).to.equal(guardOnchain);
    expect(result.transformations).to.deep.equal([
      { type: 'replace', reason: 'callProtection', offset: 1 },
    ]);
    expect(result.transformationValues).to.deep.equal({
      callProtection: '0x' + ADDRESS_A,
    });
  });

  it('does not touch a leading PUSH20 in Yul', () => {
    const result = extractCallProtectionTransformation(
      guardTemplate,
      guardOnchain,
      'Yul',
    );
    expect(result.populatedRecompiledBytecode).to.equal(guardTemplate);
    expect(result.transformations).to.be.empty;
    expect(result.transformationValues).to.deep.equal({});
  });

  it('does not touch a PUSH20 that is not followed by ADDRESS EQ', () => {
    // PUSH20 <addr> BALANCE: the operand is used as data
    const template = `0x73${ZERO_ADDRESS}3150`;
    const onchain = `0x73${ADDRESS_A}3150`;
    const result = extractCallProtectionTransformation(
      template,
      onchain,
      'Solidity',
    );
    expect(result.populatedRecompiledBytecode).to.equal(template);
    expect(result.transformations).to.be.empty;
  });
});

describe('extractLibrariesTransformation', () => {
  const fqn = 'Lib.sol:MathLib';
  const placeholder = '__$' + keccak256Str(fqn).slice(2).slice(0, 34) + '$__';
  // 0x | 6080 | <placeholder> | aa | <placeholder> | 00
  const template = `0x6080${placeholder}aa${placeholder}00`;
  const linkReferences = {
    'Lib.sol': {
      MathLib: [
        { start: 2, length: 20 },
        { start: 23, length: 20 },
      ],
    },
  } as unknown as LinkReferences;

  it('accepts the same address at every link reference', () => {
    const onchain = `0x6080${ADDRESS_A}aa${ADDRESS_A}00`;
    const result = extractLibrariesTransformation(
      template,
      onchain,
      linkReferences,
    );
    expect(result.inconsistentLibraries).to.be.undefined;
    expect(result.populatedRecompiledBytecode).to.equal(onchain);
    expect(result.transformationValues.libraries).to.deep.equal({
      [fqn]: '0x' + ADDRESS_A,
    });
    expect(result.transformations).to.have.lengthOf(2);
  });

  it('reports a library linked to different addresses', () => {
    const onchain = `0x6080${ADDRESS_A}aa${ADDRESS_B}00`;
    const result = extractLibrariesTransformation(
      template,
      onchain,
      linkReferences,
    );
    expect(result.inconsistentLibraries).to.deep.equal({
      [fqn]: ['0x' + ADDRESS_A, '0x' + ADDRESS_B],
    });
  });
});
