import { describe, it } from 'mocha';
import { expect } from 'chai';
import { findAuxdataPositions } from '../../src/Compilation/auxdataUtils';

// Builds a CBOR auxdata block (ipfs + solc version) with the given 32-byte hash (hex, 64 chars)
function auxdataBlock(ipfsHash: string) {
  return `a2646970667358221220${ipfsHash}64736f6c63430008110033`;
}

describe('auxdataUtils', () => {
  describe('findAuxdataPositions', () => {
    const HASH_A = '11'.repeat(32);
    const HASH_A_EDITED = '22'.repeat(32);
    const HASH_B = '33'.repeat(32);
    const HASH_B_EDITED = '44'.repeat(32);

    const AUXDATA_A = auxdataBlock(HASH_A);
    const AUXDATA_A_EDITED = auxdataBlock(HASH_A_EDITED);
    const AUXDATA_B = auxdataBlock(HASH_B);
    const AUXDATA_B_EDITED = auxdataBlock(HASH_B_EDITED);

    const CODE = '60806040525f80fd';

    it('should find a single auxdata position', () => {
      const original = `0x${CODE}${AUXDATA_A}`;
      const edited = `0x${CODE}${AUXDATA_A_EDITED}`;

      const result = findAuxdataPositions(
        original,
        edited,
        [AUXDATA_A],
        [AUXDATA_A_EDITED],
      );

      expect(result).to.deep.equal({
        '1': {
          offset: CODE.length / 2,
          value: `0x${AUXDATA_A}`,
        },
      });
    });

    it('should find positions of two different auxdatas', () => {
      const original = `0x${CODE}${AUXDATA_B}${CODE}${AUXDATA_A}`;
      const edited = `0x${CODE}${AUXDATA_B_EDITED}${CODE}${AUXDATA_A_EDITED}`;

      const result = findAuxdataPositions(
        original,
        edited,
        [AUXDATA_A, AUXDATA_B],
        [AUXDATA_A_EDITED, AUXDATA_B_EDITED],
      );

      expect(result).to.deep.equal({
        '1': {
          offset: (CODE.length + AUXDATA_B.length + CODE.length) / 2,
          value: `0x${AUXDATA_A}`,
        },
        '2': {
          offset: CODE.length / 2,
          value: `0x${AUXDATA_B}`,
        },
      });
    });

    it('should find all occurrences of an auxdata that repeats in the bytecode', () => {
      // A contract can embed the same child contract's bytecode multiple times
      // (e.g. a factory embedding a child's creation code in several code paths).
      // The compiler output lists the child's auxdata only once, but the bytecode
      // contains it at multiple positions. All of them have to be found, otherwise
      // the not-found occurrences are never transformed during verification.
      const original = `0x${CODE}${AUXDATA_B}${CODE}${AUXDATA_B}${CODE}${AUXDATA_B}${CODE}${AUXDATA_A}`;
      const edited = `0x${CODE}${AUXDATA_B_EDITED}${CODE}${AUXDATA_B_EDITED}${CODE}${AUXDATA_B_EDITED}${CODE}${AUXDATA_A_EDITED}`;

      const result = findAuxdataPositions(
        original,
        edited,
        [AUXDATA_A, AUXDATA_B],
        [AUXDATA_A_EDITED, AUXDATA_B_EDITED],
      );

      const unit = (CODE.length + AUXDATA_B.length) / 2;
      expect(result).to.deep.equal({
        '1': {
          offset: 3 * unit + CODE.length / 2,
          value: `0x${AUXDATA_A}`,
        },
        '2': {
          offset: CODE.length / 2,
          value: `0x${AUXDATA_B}`,
        },
        '3': {
          offset: unit + CODE.length / 2,
          value: `0x${AUXDATA_B}`,
        },
        '4': {
          offset: 2 * unit + CODE.length / 2,
          value: `0x${AUXDATA_B}`,
        },
      });
    });

    it('should map identical auxdatas listed multiple times by the compiler to distinct positions', () => {
      // Multiple identical auxdata entries from the compiler output
      // (see https://github.com/argotorg/sourcify/issues/1980)
      const original = `0x${CODE}${AUXDATA_A}${CODE}${AUXDATA_A}`;
      const edited = `0x${CODE}${AUXDATA_A_EDITED}${CODE}${AUXDATA_A_EDITED}`;

      const result = findAuxdataPositions(
        original,
        edited,
        [AUXDATA_A, AUXDATA_A],
        [AUXDATA_A_EDITED, AUXDATA_A_EDITED],
      );

      expect(result).to.deep.equal({
        '1': {
          offset: CODE.length / 2,
          value: `0x${AUXDATA_A}`,
        },
        '2': {
          offset: (CODE.length + AUXDATA_A.length + CODE.length) / 2,
          value: `0x${AUXDATA_A}`,
        },
      });
    });

    it('should not record a position where the bytecodes do not differ', () => {
      // An auxdata-like constant that does not change with edited sources
      // (e.g. attacker-embedded static bytes) must not be recorded.
      const original = `0x${CODE}${AUXDATA_A}${CODE}${AUXDATA_A}`;
      // Only the second occurrence changes with the edited sources
      const edited = `0x${CODE}${AUXDATA_A}${CODE}${AUXDATA_A_EDITED}`;

      const result = findAuxdataPositions(
        original,
        edited,
        [AUXDATA_A],
        [AUXDATA_A_EDITED],
      );

      expect(result).to.deep.equal({
        '1': {
          offset: (CODE.length + AUXDATA_A.length + CODE.length) / 2,
          value: `0x${AUXDATA_A}`,
        },
      });
    });
  });
});
