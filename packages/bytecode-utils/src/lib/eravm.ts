import {
  AuxdataStyle,
  CBOR_LENGTH_HEX_BYTES,
  decodeSolidityCborObject,
  splitCborAuxdata,
  type SolidityDecodedObject,
} from './cbor';

const ERA_VM_WORD_SIZE_BYTES = 32;
const ERA_VM_WORD_SIZE_HEX = ERA_VM_WORD_SIZE_BYTES * 2;
const ERA_VM_ZERO_WORD_HEX = '00'.repeat(ERA_VM_WORD_SIZE_BYTES);

const isZeroHex = (hex: string): boolean => /^0*$/.test(hex);

/**
 * Splits EraVM (zksolc) bytecode into execution bytecode and auxdata.
 *
 * The zksolc CBOR block uses the same [cbor][2-byte length] tail as Solidity,
 * so reuse the shared extraction to locate and validate the CBOR. The only
 * EraVM-specific step is absorbing the zero word-alignment padding that
 * precedes the CBOR into the auxdata region. If no CBOR is found (e.g. a
 * pre-1.5.13 bare keccak256 metadata hash), there is no auxdata to split.
 */
export const splitEraVmAuxdata = (
  bytecode: string,
): [string, string?, string?] => {
  const [, cbor, cborLengthHex] = splitCborAuxdata(
    bytecode,
    AuxdataStyle.SOLIDITY,
  );
  if (!cbor || cborLengthHex === undefined) {
    return [bytecode];
  }

  const bytecodeWithoutPrefix = bytecode.slice(2);
  const cborByteLength = parseInt(cborLengthHex, 16);
  const cborStart =
    bytecodeWithoutPrefix.length - CBOR_LENGTH_HEX_BYTES - cbor.length;

  const logicalMetadataLengthBytes = cborByteLength + 2;
  const alignedMetadataLengthBytes =
    Math.ceil(logicalMetadataLengthBytes / ERA_VM_WORD_SIZE_BYTES) *
    ERA_VM_WORD_SIZE_BYTES;
  let metadataStart =
    bytecodeWithoutPrefix.length - alignedMetadataLengthBytes * 2;

  if (metadataStart < 0 || metadataStart > cborStart) {
    return [bytecode];
  }

  const alignmentPadding = bytecodeWithoutPrefix.substring(
    metadataStart,
    cborStart,
  );
  if (alignmentPadding.length > 0 && !isZeroHex(alignmentPadding)) {
    return [bytecode];
  }

  const paddingWordStart = metadataStart - ERA_VM_WORD_SIZE_HEX;
  if (
    paddingWordStart >= 0 &&
    bytecodeWithoutPrefix.substring(paddingWordStart, metadataStart) ===
      ERA_VM_ZERO_WORD_HEX
  ) {
    metadataStart = paddingWordStart;
  }

  return [
    `0x${bytecodeWithoutPrefix.substring(0, metadataStart)}`,
    bytecodeWithoutPrefix.substring(
      metadataStart,
      bytecodeWithoutPrefix.length - CBOR_LENGTH_HEX_BYTES,
    ),
    cborLengthHex,
  ];
};

/**
 * Decodes an EraVM (zksolc) auxdata block into a SolidityDecodedObject.
 *
 * zksolc prepends zero word-alignment padding before the CBOR block, and its
 * CBOR map is otherwise structurally identical to Solidity's, so strip the
 * padding first and reuse the shared Solidity CBOR decoder. (zksolc encodes the
 * `solc` value as a descriptive `zksolc:…;solc:…;llvm:…` string, which the
 * shared decoder already handles via its nightly-build string branch.)
 *
 * @param auxdata - The EraVM auxdata region (may carry leading zero padding)
 * @returns The decoded object
 */
export const decodeEraVmAuxdata = (auxdata: string): SolidityDecodedObject => {
  return decodeSolidityCborObject(auxdata.replace(/^(?:00)+/, ''));
};
