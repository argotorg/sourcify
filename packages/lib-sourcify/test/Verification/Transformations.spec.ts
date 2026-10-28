import { expect } from 'chai';
import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import type { LinkReferences } from '@ethereum-sourcify/compilers-types';
import {
  AuxdataTransformation,
  extractImmutablesTransformation,
  extractLibrariesTransformation,
} from '../../src/Verification/Transformations';

describe('Transformations', () => {
  describe('AuxdataTransformation', () => {
    it('should create a valid replace transformation', () => {
      const transformation = AuxdataTransformation('replace', 10, '1');

      expect(transformation).to.deep.equal({
        type: 'replace',
        reason: 'cborAuxdata',
        offset: 10,
        id: '1',
      });
    });

    it('should create a valid replace transformation with explicit length', () => {
      const transformation = AuxdataTransformation('replace', 10, '1', 20);

      expect(transformation).to.deep.equal({
        type: 'replace',
        reason: 'cborAuxdata',
        offset: 10,
        id: '1',
        length: 20,
      });
    });

    it('should create a valid delete transformation', () => {
      const transformation = AuxdataTransformation('delete', 10, undefined, 20);

      expect(transformation).to.deep.equal({
        type: 'delete',
        reason: 'cborAuxdata',
        offset: 10,
        length: 20,
      });
    });

    it('should throw for replace transformation without id', () => {
      expect(() => AuxdataTransformation('replace', 10)).to.throw(
        'Invalid cborAuxdata replace transformation: id must be a non-empty string.',
      );
    });

    it('should throw for delete transformation with id', () => {
      expect(() => AuxdataTransformation('delete', 10, '1', 20)).to.throw(
        'Invalid cborAuxdata delete transformation: id must be undefined.',
      );
    });

    it('should throw for delete transformation without length', () => {
      expect(() => AuxdataTransformation('delete', 10)).to.throw(
        'Invalid cborAuxdata delete transformation: length is required.',
      );
    });
  });

  describe('Vyper immutable transformations', () => {
    const recompiledRuntime = '0x6000a165767970657283000307000b';
    const immutableValue =
      '0x000000000000000000000000216ce6e49e2e713e41383ba4c5d84a0d36189640';
    const onchainRuntime = recompiledRuntime + immutableValue.slice(2);
    const immutableOffset = 15;
    const legacyImmutableReferences = {
      '0': [{ length: 32, start: immutableOffset }],
    };

    it('appends the observed immutable value for legacy Vyper runtimes', () => {
      const result = extractImmutablesTransformation(
        recompiledRuntime,
        onchainRuntime,
        legacyImmutableReferences,
        AuxdataStyle.VYPER_LT_0_3_10,
      );

      expect(result.populatedRecompiledBytecode).to.equal(onchainRuntime);
      expect(result.transformations).to.deep.equal([
        {
          type: 'insert',
          reason: 'immutable',
          offset: immutableOffset,
          id: '0',
        },
      ]);
      expect(result.transformationValues).to.deep.equal({
        immutables: {
          '0': immutableValue,
        },
      });
    });

    it('appends the observed immutable value for Vyper 0.3.10+ runtimes', () => {
      const result = extractImmutablesTransformation(
        recompiledRuntime,
        onchainRuntime,
        legacyImmutableReferences,
        AuxdataStyle.VYPER,
      );

      expect(result.populatedRecompiledBytecode).to.equal(onchainRuntime);
      expect(result.transformations).to.deep.equal([
        {
          type: 'insert',
          reason: 'immutable',
          offset: immutableOffset,
          id: '0',
        },
      ]);
      expect(result.transformationValues).to.deep.equal({
        immutables: {
          '0': immutableValue,
        },
      });
    });

    it('appends a multiword Vyper immutable tail using the derived length', () => {
      const firstImmutableValue = '11'.repeat(32);
      const secondImmutableValue = '22'.repeat(64);
      const multiwordOnchainRuntime =
        recompiledRuntime + firstImmutableValue + secondImmutableValue;
      const multiwordImmutableReferences = {
        '0': [{ length: 96, start: immutableOffset }],
      };

      const result = extractImmutablesTransformation(
        recompiledRuntime,
        multiwordOnchainRuntime,
        multiwordImmutableReferences,
        AuxdataStyle.VYPER_LT_0_3_10,
      );

      expect(result.populatedRecompiledBytecode).to.equal(
        multiwordOnchainRuntime,
      );
      expect(result.transformations).to.deep.equal([
        {
          type: 'insert',
          reason: 'immutable',
          offset: immutableOffset,
          id: '0',
        },
      ]);
      expect(result.transformationValues).to.deep.equal({
        immutables: {
          '0': `0x${firstImmutableValue}${secondImmutableValue}`,
        },
      });
    });

    it('throws when the onchain bytecode lacks the inferred Vyper immutable tail', () => {
      expect(() =>
        extractImmutablesTransformation(
          recompiledRuntime,
          recompiledRuntime,
          legacyImmutableReferences,
          AuxdataStyle.VYPER_LT_0_3_10,
        ),
      ).to.throw('Vyper immutable length mismatch');
    });

    it('does not reconstruct an oversized onchain runtime', () => {
      // The immutable tail is appended, but the populated bytecode does not
      // equal the longer onchain runtime, so the matchBytecodes comparison
      // rejects it (no false match).
      const onchainRuntimeWithOversizedTail = onchainRuntime + '00'.repeat(32);

      const result = extractImmutablesTransformation(
        recompiledRuntime,
        onchainRuntimeWithOversizedTail,
        legacyImmutableReferences,
        AuxdataStyle.VYPER_LT_0_3_10,
      );

      expect(result.populatedRecompiledBytecode).to.not.equal(
        onchainRuntimeWithOversizedTail,
      );
    });

    it('does not reconstruct a runtime whose prefix differs', () => {
      // The immutable tail is appended, but since the runtime prefix differs the
      // populated bytecode does not equal the onchain runtime, so matchBytecodes
      // rejects it (no false match).
      const onchainRuntimeWithPrefixDifference =
        '0x6100' + recompiledRuntime.slice(6) + immutableValue.slice(2);

      const result = extractImmutablesTransformation(
        recompiledRuntime,
        onchainRuntimeWithPrefixDifference,
        legacyImmutableReferences,
        AuxdataStyle.VYPER_LT_0_3_10,
      );

      expect(result.populatedRecompiledBytecode).to.not.equal(
        onchainRuntimeWithPrefixDifference,
      );
    });

    [
      AuxdataStyle.VYPER_LT_0_3_4,
      AuxdataStyle.VYPER_LT_0_3_5,
      AuxdataStyle.VYPER_LT_0_3_10,
      AuxdataStyle.VYPER,
    ].forEach((auxdataStyle) => {
      it(`validates and appends a Vyper immutable for ${auxdataStyle}`, () => {
        const result = extractImmutablesTransformation(
          recompiledRuntime,
          onchainRuntime,
          legacyImmutableReferences,
          auxdataStyle,
        );

        expect(result.populatedRecompiledBytecode).to.equal(onchainRuntime);
        expect(result.transformations).to.have.length(1);
      });
    });

    it('keeps Solidity immutable replacement behavior unchanged', () => {
      const solidityRecompiledRuntime =
        '0x6000' + '00'.repeat(32) + 'a165627a7a72305820';
      const solidityOnchainRuntime =
        '0x6000' + immutableValue.slice(2) + 'a165627a7a72305820';
      const solidityImmutableReferences = {
        '1': [{ length: 32, start: 2 }],
      };

      const result = extractImmutablesTransformation(
        solidityRecompiledRuntime,
        solidityOnchainRuntime,
        solidityImmutableReferences,
        AuxdataStyle.SOLIDITY,
      );

      expect(result.populatedRecompiledBytecode).to.equal(
        solidityOnchainRuntime,
      );
    });
  });

  describe('extractLibrariesTransformation', () => {
    const ADDRESS = '1111111111111111111111111111111111111111';
    const linkReferences: LinkReferences = {
      'libraries/Lib.sol': { Lib: [{ start: 1, length: 20 }] },
    };
    const real = '0x73' + ADDRESS;
    const expectedResult = {
      populatedRecompiledBytecode: real,
      libraryMap: { ['__Lib___________________________________']: ADDRESS },
      transformations: [
        {
          type: 'replace',
          reason: 'library',
          offset: 1,
          id: 'libraries/Lib.sol:Lib',
        },
      ],
      transformationValues: {
        libraries: { 'libraries/Lib.sol:Lib': '0x' + ADDRESS },
      },
    };

    it('accepts the bare-name placeholder for solc < 0.4.9', () => {
      const template = '0x73' + '__Lib___________________________________';
      expect(
        extractLibrariesTransformation(
          template,
          real,
          linkReferences,
          '0.1.6+commit.d41f8b7c',
        ),
      ).to.deep.equal(expectedResult);
    });

    it('rejects the bare-name placeholder for solc >= 0.4.9', () => {
      const template = '0x73' + '__Lib___________________________________';
      expect(() =>
        extractLibrariesTransformation(
          template,
          real,
          linkReferences,
          '0.4.9+commit.364da425',
        ),
      ).to.throw('Library placeholder mismatch');
      expect(() =>
        extractLibrariesTransformation(template, real, linkReferences),
      ).to.throw('Library placeholder mismatch');
    });

    it('accepts the file:Lib placeholder for solc 0.4.9', () => {
      const template = '0x73' + '__libraries/Lib.sol:Lib_________________';
      const result = extractLibrariesTransformation(
        template,
        real,
        linkReferences,
        '0.4.9+commit.364da425',
      );
      expect(result.transformations).to.deep.equal(
        expectedResult.transformations,
      );
      expect(result.populatedRecompiledBytecode).to.equal(real);
    });

    it('does not throw for a compiler version that is not valid semver', () => {
      expect(
        extractLibrariesTransformation(
          real,
          real,
          {},
          '0.4.1b1+commit.039d3692',
        ),
      ).to.deep.equal({
        populatedRecompiledBytecode: real,
        libraryMap: {},
        transformations: [],
        transformationValues: {},
      });
    });
  });
});
