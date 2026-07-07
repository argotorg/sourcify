import chai from 'chai';

import { AuxdataStyle, decode, splitAuxdata } from '../src/lib/bytecode';

// zksolc 1.5.15 tail: CBOR metadata (IPFS + descriptive zksolc/solc/llvm version
// string) preceded by zero word-alignment padding.
const ZKSYNC_ABSTRACT_1_5_15_TAIL =
  '0x9e2cb40b00000000000000000000000000000000000000000000000000000000d543610e6057093c81336d006b5249a51d6844768d5a0ffcf85636f37df255ac319284ad7d4265c99e51f9e0112e2425b1ad54f8c4e06d7a4191eaa263c72b15000000000000000000000000000000000000000000000000ffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000a264697066735822122007a4f6fdcc0e2b25207322b1a32774e47a4cfef8ba295d46da4f0f0be49859d964736f6c6378247a6b736f6c633a312e352e31353b736f6c633a302e382e32363b6c6c766d3a312e302e320055';
// Synthetic IPFS-only CBOR block with 20 bytes of alignment padding.
const ZKSYNC_IPFS_ONLY_CBOR_BYTECODE = `0x${'aa'.repeat(32)}${'00'.repeat(
  20,
)}a16469706673582212208acf048570dcc1c3ff41bf8f20376049a42ae8a471f2b2ae8c14d8b356d86d79002a`;
// zksolc 1.5.7 tail: pre-1.5.13 bare keccak256 metadata hash (no CBOR).
const ZKSYNC_ABSTRACT_1_5_7_TAIL =
  '0x416273747261637420426164676573000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000d9b67a260000000000000000000000000000000000000020000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1ba3b6579b23c9248232fe1a7fb885b70411346f3aad2273798356706e601a5a';

describe('eravm (zksolc) bytecode utils', function () {
  it('split zkSync EraVM CBOR auxdata with compiler version metadata', () => {
    const [execution, auxdata, length] = splitAuxdata(
      ZKSYNC_ABSTRACT_1_5_15_TAIL,
      AuxdataStyle.ZKSYNC,
    );
    chai.expect(length).to.equal('0055');
    chai.expect(auxdata).to.not.be.undefined;
    chai.expect(auxdata).to.have.length(126 * 2);
    chai
      .expect(auxdata)
      .to.match(
        /^0{82}a264697066735822122007a4f6fdcc0e2b25207322b1a32774e47a4cfef8ba295d46da4f0f0be49859d964736f6c6378247a6b736f6c633a312e352e31353b736f6c633a302e382e32363b6c6c766d3a312e302e32$/,
      );
    chai
      .expect(`${execution}${auxdata}${length}`)
      .to.equal(ZKSYNC_ABSTRACT_1_5_15_TAIL);
  });

  it('split zkSync EraVM IPFS-only CBOR auxdata with 32-byte alignment padding', () => {
    const [execution, auxdata, length] = splitAuxdata(
      ZKSYNC_IPFS_ONLY_CBOR_BYTECODE,
      AuxdataStyle.ZKSYNC,
    );

    chai.expect(length).to.equal('002a');
    chai
      .expect(auxdata)
      .to.equal(
        `${'00'.repeat(
          20,
        )}a16469706673582212208acf048570dcc1c3ff41bf8f20376049a42ae8a471f2b2ae8c14d8b356d86d79`,
      );
    chai.expect(execution).to.equal(`0x${'aa'.repeat(32)}`);
    chai
      .expect(`${execution}${auxdata}${length}`)
      .to.equal(ZKSYNC_IPFS_ONLY_CBOR_BYTECODE);
  });

  it('return the full bytecode with no CBOR auxdata for bare-hash zkSync EraVM contracts', () => {
    const [execution, auxdata, length] = splitAuxdata(
      ZKSYNC_ABSTRACT_1_5_7_TAIL,
      AuxdataStyle.ZKSYNC,
    );
    chai.expect(auxdata).to.be.undefined;
    chai.expect(length).to.be.undefined;
    chai.expect(execution).to.equal(ZKSYNC_ABSTRACT_1_5_7_TAIL);
  });

  it('bytecode decode zkSync EraVM cbor through the leading zero padding', () => {
    // The auxdata block carries leading zero word-alignment padding before the
    // CBOR; decode must strip it and still recover the ipfs hash and the zksolc
    // version string (zksolc encodes `solc` as a descriptive string, not bytes).
    chai
      .expect(decode(ZKSYNC_ABSTRACT_1_5_15_TAIL, AuxdataStyle.ZKSYNC))
      .to.deep.equal({
        ipfs: 'QmNrVTanh1MSVgK97knBi4XGyQUgu6cqQwcmMjbPepv5wv',
        solcVersion: 'zksolc:1.5.15;solc:0.8.26;llvm:1.0.2',
      });
  });
});
