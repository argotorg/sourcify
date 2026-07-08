import { getBytes, sha256 } from 'ethers';
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

// Version prefix of the ZKsync versioned bytecode hash (EraVM = 0x0100).
const ERA_VM_BYTECODE_HASH_VERSION_HEX = '0100';

const isZeroHex = (hex: string): boolean => /^0*$/.test(hex);

/**
 * Computes the ZKsync "versioned bytecode hash" for a piece of EraVM bytecode.
 * This is the 32-byte value a deployment references (in the ContractDeployer
 * `create`/`create2` calldata) instead of embedding the full bytecode. Layout:
 *
 *   bytes 0-1   version (0x0100 for EraVM)
 *   bytes 2-3   bytecode length in 32-byte words (big-endian)
 *   bytes 4-31  the last 28 bytes of sha256(bytecode)
 *
 * The input must be word-aligned (EraVM bytecode always is). See
 * https://docs.zksync.io/zksync-protocol/era-vm/differences/contract-deployment
 *
 * @param bytecode - EraVM bytecode as a hex string (with or without 0x prefix)
 * @returns the 32-byte versioned hash as a 0x-prefixed hex string
 */
export const eraBytecodeHash = (bytecode: string): string => {
  const bytes = getBytes(
    bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`,
  );
  if (bytes.length % ERA_VM_WORD_SIZE_BYTES !== 0) {
    throw Error(
      `EraVM bytecode length must be a multiple of ${ERA_VM_WORD_SIZE_BYTES} bytes, got ${bytes.length}`,
    );
  }
  const lengthInWords = bytes.length / ERA_VM_WORD_SIZE_BYTES;
  const lengthHex = lengthInWords.toString(16).padStart(4, '0');
  // sha256() returns a 0x-prefixed 32-byte (64 hex char) digest; keep the last
  // 28 bytes (56 hex chars), i.e. drop the leading 4 bytes (8 hex chars).
  const shaHex = sha256(bytes).slice(2);
  return `0x${ERA_VM_BYTECODE_HASH_VERSION_HEX}${lengthHex}${shaHex.slice(8)}`;
};

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
