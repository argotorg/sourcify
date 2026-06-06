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

    it('infers a synthetic immutable reference for an append-only legacy Vyper tail', () => {
      const immutableReferences = inferLegacyVyperImmutableReferences(
        recompiledRuntime,
        onchainRuntime,
        AuxdataStyle.VYPER_LT_0_3_10,
        compilerVersion,
        true,
      );

      expect(immutableReferences).to.deep.equal({
        '0': [{ length: 32, start: immutableOffset }],
      });
    });

    it('appends the observed immutable value for legacy Vyper runtimes', () => {
      const result = extractImmutablesTransformation(
        recompiledRuntime,
        onchainRuntime,
        {},
        AuxdataStyle.VYPER_LT_0_3_10,
        compilerVersion,
        true,
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

    it('does not infer a legacy Vyper immutable without an AST immutable declaration', () => {
      const immutableReferences = inferLegacyVyperImmutableReferences(
        recompiledRuntime,
        onchainRuntime,
        AuxdataStyle.VYPER_LT_0_3_10,
        compilerVersion,
        false,
      );

      expect(immutableReferences).to.deep.equal({});
    });

    it('does not infer a legacy Vyper immutable for the 0.3.10+ auxdata layout', () => {
      const immutableReferences = inferLegacyVyperImmutableReferences(
        recompiledRuntime,
        onchainRuntime,
        AuxdataStyle.VYPER,
        '0.3.10+commit.91361694',
        true,
      );

      expect(immutableReferences).to.deep.equal({});
    });
  });
});
