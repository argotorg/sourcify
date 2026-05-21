import chai from 'chai';
import { readFileSync } from 'fs';
import path from 'path';

import { AuxdataStyle, decode, splitAuxdata } from '../src/lib/bytecode';

type Error = {
  message: string;
};

const BYTECODES_FOLDER = path.join(__dirname, 'bytecodes');
const BYTECODE_IPFS = readFileSync(`${BYTECODES_FOLDER}/ipfs.hex`).toString();
const BYTECODE_BZZR1 = readFileSync(`${BYTECODES_FOLDER}/bzzr1.hex`).toString();
const BYTECODE_WRONG = readFileSync(`${BYTECODES_FOLDER}/wrong.hex`).toString();
const BYTECODE_EXPERIMENTAL = readFileSync(
  `${BYTECODES_FOLDER}/experimental.hex`,
).toString();
const BYTECODE_WITHOUT0X = readFileSync(
  `${BYTECODES_FOLDER}/without0x.hex`,
).toString();
const BYTECODE_WITHOUTAUXDATA = readFileSync(
  `${BYTECODES_FOLDER}/withoutauxdata.hex`,
).toString();
const BYTECODE_VYPER_INTEGRITY = readFileSync(
  `${BYTECODES_FOLDER}/vyper-integrity.hex`,
).toString();
const BYTECODE_VYPER_NO_INTEGRITY = readFileSync(
  `${BYTECODES_FOLDER}/vyper-no-integrity.hex`,
).toString();
const BYTECODE_VYPER_NO_ARRAY = readFileSync(
  `${BYTECODES_FOLDER}/vyper-cbor-no-array.hex`,
).toString();
const BYTECODE_VYPER_NO_AUXDATA_LENGTH = readFileSync(
  `${BYTECODES_FOLDER}/vyper-no-auxdata-length.hex`,
).toString();
const ZKSYNC_ABSTRACT_1_5_15_TAIL =
  '0x9e2cb40b00000000000000000000000000000000000000000000000000000000d543610e6057093c81336d006b5249a51d6844768d5a0ffcf85636f37df255ac319284ad7d4265c99e51f9e0112e2425b1ad54f8c4e06d7a4191eaa263c72b15000000000000000000000000000000000000000000000000ffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000a264697066735822122007a4f6fdcc0e2b25207322b1a32774e47a4cfef8ba295d46da4f0f0be49859d964736f6c6378247a6b736f6c633a312e352e31353b736f6c633a302e382e32363b6c6c766d3a312e302e320055';
const ZKSYNC_IPFS_ONLY_CBOR_BYTECODE = `0x${'aa'.repeat(32)}${'00'.repeat(
  20,
)}a16469706673582212208acf048570dcc1c3ff41bf8f20376049a42ae8a471f2b2ae8c14d8b356d86d79002a`;
const ZKSYNC_ABSTRACT_1_5_7_TAIL =
  '0x416273747261637420426164676573000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000d9b67a260000000000000000000000000000000000000020000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1ba3b6579b23c9248232fe1a7fb885b70411346f3aad2273798356706e601a5a';

describe('bytecode utils', function () {
  it("return the whole bytecode when the bytecode that doesn't contain auxdata", () => {
    const [execution, auxadata, length] = splitAuxdata(
      BYTECODE_WITHOUTAUXDATA,
      AuxdataStyle.SOLIDITY,
    );
    chai.expect(auxadata).to.be.undefined;
    chai.expect(length).to.be.undefined;
    chai.expect(`${execution}`).to.equal(BYTECODE_WITHOUTAUXDATA);
  });

  it('return the full bytecode with no auxdata for Fe contracts', () => {
    // Use an existing bytecode (e.g. BYTECODE_IPFS) to verify Fe path
    // always returns the full bytecode unchanged, regardless of content
    const [execution, auxdata, length] = splitAuxdata(
      BYTECODE_IPFS,
      AuxdataStyle.FE,
    );
    chai.expect(auxdata).to.be.undefined;
    chai.expect(length).to.be.undefined;
    chai.expect(execution).to.equal(BYTECODE_IPFS);
  });

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

  it('return the full bytecode with no auxdata for Vyper < 0.3.4 contracts', () => {
    // Vyper versions prior to 0.3.4 emit no CBOR auxdata at all
    const [execution, auxdata, length] = splitAuxdata(
      BYTECODE_IPFS,
      AuxdataStyle.VYPER_LT_0_3_4,
    );
    chai.expect(auxdata).to.be.undefined;
    chai.expect(length).to.be.undefined;
    chai.expect(execution).to.equal(BYTECODE_IPFS);
  });

  it('split succesfully bytecode into execution bytecode and auxadata', () => {
    const [execution, auxadata, length] = splitAuxdata(
      BYTECODE_IPFS,
      AuxdataStyle.SOLIDITY,
    );
    chai
      .expect(auxadata)
      .to.equal(
        'a2646970667358221220dceca8706b29e917dacf25fceef95acac8d90d765ac926663ce4096195952b6164736f6c634300060b',
      );
    chai.expect(`${execution}${auxadata}${length}`, BYTECODE_IPFS);
  });

  it('bytecode decode cbor with `ipfs` property', () => {
    chai
      .expect(decode(BYTECODE_IPFS, AuxdataStyle.SOLIDITY).ipfs)
      .to.equal('QmdD3hpMj6mEFVy9DP4QqjHaoeYbhKsYvApX1YZNfjTVWp');
  });

  it('bytecode decode cbor with `bzzr1` property', () => {
    chai
      .expect(decode(BYTECODE_BZZR1, AuxdataStyle.SOLIDITY).bzzr1)
      .to.equal(
        '0x71e0c183217ae3e9a1406ae7b58c2f36e09f2b16b10e19d46ceb821f3ee6abad',
      );
  });

  it('bytecode decode cbor with `experimental` property', () => {
    chai.expect(
      decode(BYTECODE_EXPERIMENTAL, AuxdataStyle.SOLIDITY).experimental,
    ).to.be.true;
  });

  it('bytecode decode Vyper cbor auxdata for version >= 0.4.1', () => {
    chai
      .expect(decode(BYTECODE_VYPER_INTEGRITY, AuxdataStyle.VYPER))
      .to.deep.equal({
        integrity: new Uint8Array([
          5, 183, 84, 197, 139, 46, 84, 10, 20, 171, 166, 241, 103, 23, 171, 44,
          48, 237, 199, 73, 54, 200, 152, 93, 119, 177, 82, 205, 151, 136, 126,
          7,
        ]),
        runtimeSize: 143,
        dataSizes: [],
        immutableSize: 0,
        vyperVersion: '0.4.1',
      });
  });

  it('bytecode decode Vyper cbor auxdata for version >= 0.3.10 and < 0.4.1', () => {
    chai
      .expect(decode(BYTECODE_VYPER_NO_INTEGRITY, AuxdataStyle.VYPER))
      .to.deep.equal({
        runtimeSize: 143,
        dataSizes: [],
        immutableSize: 0,
        vyperVersion: '0.3.10',
      });
  });

  it('bytecode decode Vyper cbor auxdata for version < 0.3.10', () => {
    chai
      .expect(decode(BYTECODE_VYPER_NO_ARRAY, AuxdataStyle.VYPER_LT_0_3_10))
      .to.deep.equal({
        vyperVersion: '0.3.8',
      });
  });

  it('bytecode decode Vyper cbor auxdata for version < 0.3.5', () => {
    chai
      .expect(
        decode(BYTECODE_VYPER_NO_AUXDATA_LENGTH, AuxdataStyle.VYPER_LT_0_3_5),
      )
      .to.deep.equal({
        vyperVersion: '0.3.4',
      });
  });

  it('split Vyper bytecode (>= 0.4.1) into execution bytecode and auxdata', () => {
    const [execution, auxdata, length] = splitAuxdata(
      BYTECODE_VYPER_INTEGRITY,
      AuxdataStyle.VYPER,
    );
    chai.expect(auxdata).to.not.be.undefined;
    chai.expect(length).to.equal('0034');
    chai
      .expect(auxdata)
      .to.equal(
        '85582005b754c58b2e540a14aba6f16717ab2c30edc74936c8985d77b152cd97887e07188f8000a165767970657283000401',
      );
    chai
      .expect(`${execution}${auxdata}${length}`)
      .to.equal(BYTECODE_VYPER_INTEGRITY);
  });

  it('split Vyper bytecode (>= 0.3.10) into execution bytecode and auxdata', () => {
    const [execution, auxdata, length] = splitAuxdata(
      BYTECODE_VYPER_NO_INTEGRITY,
      AuxdataStyle.VYPER,
    );
    chai.expect(auxdata).to.not.be.undefined;
    chai.expect(length).to.equal('0012');
    chai.expect(auxdata).to.equal('84188f8000a16576797065728300030a');
    chai
      .expect(`${execution}${auxdata}${length}`)
      .to.equal(BYTECODE_VYPER_NO_INTEGRITY);
  });

  it('bytecode decode should fail gracefully when input is undefined', () => {
    try {
      decode('', AuxdataStyle.SOLIDITY);
    } catch (e) {
      chai.expect((e as Error).message).to.equal('Bytecode cannot be null');
    }
  });

  it('decode a bytecode not starting with 0x', () => {
    chai
      .expect(decode(BYTECODE_WITHOUT0X, AuxdataStyle.SOLIDITY).ipfs)
      .to.equal('QmbFc3AoHDC977j2UH2WwYSwsSRrBGj8bsiiyigXhHzyuZ');
  });

  it('bytecode decode should fail gracefully when input is corrupted', () => {
    try {
      decode(BYTECODE_WRONG, AuxdataStyle.SOLIDITY);
    } catch (e) {
      chai
        .expect((e as Error).message)
        .to.equal('Auxdata is not in the bytecode');
    }
  });
});
