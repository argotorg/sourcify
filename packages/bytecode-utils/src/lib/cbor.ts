import { getBytes, hexlify } from 'ethers';
import bs58 from 'bs58';
import * as CBOR from 'cbor-x';

/**
 * Number of hex characters used to encode the trailing 2-byte CBOR length.
 */
export const CBOR_LENGTH_HEX_BYTES = 4;

export type SolidityDecodedObject = {
  // Known CBOR fields that are defined in the spec
  ipfs?: string;
  solcVersion?: string;
  experimental?: boolean;
  bzzr0?: string;
  bzzr1?: string;
  // Any other CBOR field that is not explicitly defined above. This is a catch-all for future extensions.
  [key: string]: string | Uint8Array | undefined | boolean;
};

export enum AuxdataStyle {
  SOLIDITY = 'solidity',
  VYPER = 'vyper',
  VYPER_LT_0_3_10 = 'vyper_lt_0_3_10',
  VYPER_LT_0_3_5 = 'vyper_lt_0_3_5',
  VYPER_LT_0_3_4 = 'vyper_lt_0_3_4',
  FE = 'fe',
  ZKSYNC = 'zksync',
}

/**
 * Validates that the bytecode is not empty.
 *
 * @param bytecode - The bytecode string to validate
 */
export const validateBytecode = (bytecode: string) => {
  if (bytecode.length === 0) {
    throw Error('Bytecode cannot be null');
  }
};

/**
 * Ensures the bytecode string starts with '0x'.
 *
 * @param bytecode - The bytecode string
 * @returns The bytecode string with '0x' prefix
 */
export const ensureHexPrefix = (bytecode: string): string => {
  return bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`;
};

/**
 * Reads the trailing 2-byte CBOR length, extracts that many bytes as the auxdata,
 * and verifies it is CBOR-encoded.
 *
 * @returns [executionBytecode, auxdata, cborLengthHex] on success, or [bytecode]
 * when there is no valid CBOR auxdata at the tail. Shared by the Solidity/Vyper
 * styles and reused by the EraVM split for the zksolc CBOR block.
 */
export const splitCborAuxdata = (
  bytecode: string,
  auxdataStyle: AuxdataStyle,
): [string, string?, string?] => {
  const bytesLength = CBOR_LENGTH_HEX_BYTES;
  const cborBytesLength = getCborBytesLength(
    bytecode,
    auxdataStyle,
    bytesLength,
  );

  if (
    isCborLengthInvalid(auxdataStyle, bytecode, cborBytesLength, bytesLength)
  ) {
    return [bytecode];
  }

  const auxdata = extractAuxdata(
    bytecode,
    auxdataStyle,
    cborBytesLength,
    bytesLength,
  );
  const executionBytecode = extractExecutionBytecode(
    bytecode,
    auxdataStyle,
    cborBytesLength,
    bytesLength,
  );

  if (isCborEncoded(auxdata)) {
    const cborLengthHex = getCborLengthHex(bytecode, auxdataStyle, bytesLength);
    return [executionBytecode, auxdata, cborLengthHex];
  }

  return [bytecode];
};

/**
 * Decodes a Solidity-shaped CBOR auxdata block into a SolidityDecodedObject.
 * The input is the hex string of the CBOR map (no trailing length bytes, no
 * leading padding).
 *
 * @param cborHex - Hex string of the CBOR map (without 0x prefix)
 * @returns The decoded object
 */
export const decodeSolidityCborObject = (
  cborHex: string,
): SolidityDecodedObject => {
  const cborDecodedObject = CBOR.decode(getBytes(`0x${cborHex}`));

  const result: SolidityDecodedObject = {};
  // Decode all the parameters from the json
  Object.keys(cborDecodedObject).forEach((key: string) => {
    switch (key) {
      case 'ipfs': {
        const ipfsCID = bs58.encode(cborDecodedObject.ipfs);
        result.ipfs = ipfsCID;
        break;
      }
      case 'solc': {
        // nightly builds are string encoded
        if (typeof cborDecodedObject.solc === 'string') {
          result.solcVersion = cborDecodedObject.solc;
        } else {
          result.solcVersion = cborDecodedObject.solc.join('.');
        }
        break;
      }
      case 'experimental': {
        result.experimental = cborDecodedObject.experimental;
        break;
      }
      case 'bzzr0':
      case 'bzzr1':
      default: {
        result[key] = hexlify(cborDecodedObject[key]);
        break;
      }
    }
  });

  return result;
};

/**
 * Determines the length of the CBOR auxdata in bytes.
 *
 * @param bytecode - The complete bytecode string
 * @param auxdataStyle - The style of auxdata
 * @param bytesLength - The length of bytes used to encode the CBOR length
 * @returns An object containing the CBOR bytes length and a flag for legacy Vyper
 */
const getCborBytesLength = (
  bytecode: string,
  auxdataStyle: AuxdataStyle,
  bytesLength: number,
): number => {
  if (auxdataStyle === AuxdataStyle.VYPER_LT_0_3_5) {
    return 22; // For Vyper 0.3.4, the CBOR length is fixed because it contains only the version
  }
  const cborLengthHex = bytecode.slice(-bytesLength);
  return parseInt(cborLengthHex, 16) * 2;
};

/**
 * Checks if the CBOR length is invalid based on the bytecode length.
 *
 * @param auxdataStyle - The auxdata style (Solidity or Vyper)
 * @param bytecode - The complete bytecode string
 * @param cborBytesLength - The length of CBOR auxdata in bytes
 * @param bytesLength - The length of bytes used to encode the CBOR length
 * @returns True if the CBOR length is invalid, otherwise false
 */
const isCborLengthInvalid = (
  auxdataStyle: AuxdataStyle,
  bytecode: string,
  cborBytesLength: number,
  bytesLength: number,
): boolean => {
  if (auxdataStyle === AuxdataStyle.VYPER) {
    // Vyper includes the trailing length bytes in cborBytesLength,
    // so we only subtract cborBytesLength (no separate bytesLength).
    return bytecode.length - cborBytesLength <= 0;
  }
  return bytecode.length - bytesLength - cborBytesLength <= 0;
};

/**
 * Extracts the auxdata from the bytecode based on the auxdata style.
 *
 * @param bytecode - The complete bytecode string
 * @param auxdataStyle - The style of auxdata
 * @param cborBytesLength - The length of CBOR auxdata in bytes
 * @param bytesLength - The length of bytes used to encode the CBOR length
 * @returns The extracted auxdata as a hex string
 */
const extractAuxdata = (
  bytecode: string,
  auxdataStyle: AuxdataStyle,
  cborBytesLength: number,
  bytesLength: number,
): string => {
  switch (auxdataStyle) {
    case AuxdataStyle.VYPER_LT_0_3_10:
    case AuxdataStyle.SOLIDITY:
      return bytecode.substring(
        bytecode.length - bytesLength - cborBytesLength,
        bytecode.length - bytesLength,
      );
    case AuxdataStyle.VYPER:
      return bytecode.substring(
        bytecode.length - cborBytesLength,
        bytecode.length - bytesLength,
      );
    case AuxdataStyle.VYPER_LT_0_3_5:
      return bytecode.substring(bytecode.length - 22, bytecode.length);
    default:
      throw Error('Unsupported auxdata style');
  }
};

/**
 * Extracts the execution bytecode from the complete bytecode string.
 *
 * @param bytecode - The complete bytecode string
 * @param cborBytesLength - The length of CBOR auxdata in bytes
 * @param bytesLength - The length of bytes used to encode the CBOR length
 * @returns The execution bytecode as a hex string
 */
const extractExecutionBytecode = (
  bytecode: string,
  auxdataStyle: AuxdataStyle,
  cborBytesLength: number,
  bytesLength: number,
): string => {
  if (auxdataStyle === AuxdataStyle.VYPER) {
    // Vyper includes the trailing length bytes in cborBytesLength,
    // so we only subtract cborBytesLength to avoid double-counting.
    return bytecode.substring(0, bytecode.length - cborBytesLength);
  }
  return bytecode.substring(0, bytecode.length - bytesLength - cborBytesLength);
};

/**
 * Attempts to decode the auxdata to verify if it's CBOR-encoded.
 *
 * @param auxdata - The auxdata string to decode
 * @returns True if auxdata is CBOR-encoded, otherwise false
 */
export const isCborEncoded = (auxdata: string): boolean => {
  try {
    CBOR.decode(getBytes(`0x${auxdata}`));
    return true;
  } catch {
    return false;
  }
};

/**
 * Retrieves the CBOR length from the bytecode based on the auxdata style.
 *
 * @param bytecode - The complete bytecode string
 * @param auxdataStyle - The style of auxdata
 * @param bytesLength - The length of bytes used to encode the CBOR length
 * @returns The CBOR length as a hex string
 */
const getCborLengthHex = (
  bytecode: string,
  auxdataStyle: AuxdataStyle,
  bytesLength: number,
): string => {
  if (auxdataStyle === AuxdataStyle.VYPER_LT_0_3_5) return '';
  return bytecode.slice(-bytesLength);
};
