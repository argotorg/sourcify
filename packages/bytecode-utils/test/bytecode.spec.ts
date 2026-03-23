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
