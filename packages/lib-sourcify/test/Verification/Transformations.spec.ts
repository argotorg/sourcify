import { expect } from 'chai';
import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import {
  AuxdataTransformation,
  extractImmutablesTransformation,
  inferLegacyVyperImmutableReferences,
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

  describe('legacy Vyper immutable transformations', () => {
    const compilerVersion = '0.3.7+commit.6020b8bb';
    const recompiledRuntime = '0x6000a165767970657283000307000b';
    const immutableValue =
      '0x000000000000000000000000216ce6e49e2e713e41383ba4c5d84a0d36189640';
    const onchainRuntime = recompiledRuntime + immutableValue.slice(2);
    const immutableOffset = 15;
    const legacyImmutableReferences = {
      '0': [{ length: 32, start: immutableOffset }],
    };

    it('infers the synthetic immutable reference for an append-only legacy Vyper tail', () => {
      const immutableReferences = inferLegacyVyperImmutableReferences(
        recompiledRuntime,
        onchainRuntime,
        AuxdataStyle.VYPER_LT_0_3_10,
        legacyImmutableReferences,
        compilerVersion,
      );

      expect(immutableReferences).to.deep.equal(legacyImmutableReferences);
    });

    it('appends the observed immutable value for legacy Vyper runtimes', () => {
      const result = extractImmutablesTransformation(
        recompiledRuntime,
        onchainRuntime,
        {},
        AuxdataStyle.VYPER_LT_0_3_10,
        legacyImmutableReferences,
        compilerVersion,
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

    it('appends a multiword legacy Vyper immutable tail using the derived length', () => {
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
        {},
        AuxdataStyle.VYPER_LT_0_3_10,
        multiwordImmutableReferences,
        compilerVersion,
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

    it('does not infer a legacy Vyper immutable without derived references', () => {
      const immutableReferences = inferLegacyVyperImmutableReferences(
        recompiledRuntime,
        onchainRuntime,
        AuxdataStyle.VYPER_LT_0_3_10,
        {},
        compilerVersion,
      );

      expect(immutableReferences).to.deep.equal({});
    });

    it('does not infer a legacy Vyper immutable for the 0.3.10+ auxdata layout', () => {
      const immutableReferences = inferLegacyVyperImmutableReferences(
        recompiledRuntime,
        onchainRuntime,
        AuxdataStyle.VYPER,
        legacyImmutableReferences,
        '0.3.10+commit.91361694',
      );

      expect(immutableReferences).to.deep.equal({});
    });

    it('does not infer a legacy Vyper immutable for an oversized tail', () => {
      const onchainRuntimeWithOversizedTail = onchainRuntime + '00'.repeat(32);

      const immutableReferences = inferLegacyVyperImmutableReferences(
        recompiledRuntime,
        onchainRuntimeWithOversizedTail,
        AuxdataStyle.VYPER_LT_0_3_10,
        legacyImmutableReferences,
        compilerVersion,
      );

      expect(immutableReferences).to.deep.equal({});
    });

    [
      {
        auxdataStyle: AuxdataStyle.VYPER_LT_0_3_4,
        compilerVersion: '0.3.1+commit.b6b9fb7b',
      },
      {
        auxdataStyle: AuxdataStyle.VYPER_LT_0_3_5,
        compilerVersion: '0.3.4+commit.f31f0ec4',
      },
      {
        auxdataStyle: AuxdataStyle.VYPER_LT_0_3_10,
        compilerVersion: '0.3.9+commit.66b96705',
      },
    ].forEach(({ auxdataStyle, compilerVersion }) => {
      it(`infers a legacy Vyper immutable for ${compilerVersion}`, () => {
        const immutableReferences = inferLegacyVyperImmutableReferences(
          recompiledRuntime,
          onchainRuntime,
          auxdataStyle,
          legacyImmutableReferences,
          compilerVersion,
        );

        expect(immutableReferences).to.deep.equal(legacyImmutableReferences);
      });
    });

    [
      {
        auxdataStyle: AuxdataStyle.VYPER_LT_0_3_4,
        compilerVersion: '0.3.0+commit.8d3d8f8b',
      },
      {
        auxdataStyle: AuxdataStyle.VYPER,
        compilerVersion: '0.3.10+commit.91361694',
      },
    ].forEach(({ auxdataStyle, compilerVersion }) => {
      it(`does not infer a legacy Vyper immutable for ${compilerVersion}`, () => {
        const immutableReferences = inferLegacyVyperImmutableReferences(
          recompiledRuntime,
          onchainRuntime,
          auxdataStyle,
          legacyImmutableReferences,
          compilerVersion,
        );

        expect(immutableReferences).to.deep.equal({});
      });
    });
  });
});
