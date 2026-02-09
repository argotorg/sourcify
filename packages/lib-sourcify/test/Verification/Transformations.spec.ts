import { expect } from 'chai';
import { AuxdataTransformation } from '../../src/Verification/Transformations';

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
});
