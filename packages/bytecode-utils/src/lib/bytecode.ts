import { arrayify, hexlify } from '@ethersproject/bytes';
import bs58 from 'bs58';
import * as CBOR from 'cbor-x';
import semver from 'semver';

type CBOR = {
  bytes: string;
  length: number;
};

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

export type VyperDecodedObject = {
  integrity?: string;
  runtimeSize?: number;
  dataSizes?: number[];
  immutableSize?: number;
  vyperVersion: string;
};

export enum AuxdataStyle {
  SOLIDITY = 'solidity',
  VYPER = 'vyper',
  VYPER_LT_0_3_10 = 'vyper_lt_0_3_10',
  VYPER_LT_0_3_5 = 'vyper_lt_0_3_5',
  FE = 'fe',
}

/**
 * Decode contract's bytecode
 * @param bytecode - hex of the bytecode with 0x prefix
 * @param auxdataStyle - The style of auxdata, check AuxdataStyle enum for more info
 * @returns Object describing the contract
 */
export const decode = <T extends AuxdataStyle>(
  bytecode: string,
  auxdataStyle: T,
): T extends AuxdataStyle.SOLIDITY
  ? SolidityDecodedObject
  : VyperDecodedObject => {
  if (bytecode.length === 0) {
    throw Error('Bytecode cannot be null');
  }
  if (bytecode.substring(0, 2) !== '0x') {
    bytecode = '0x' + bytecode;
  }

  // split auxdata
  const [, auxdata] = splitAuxdata(bytecode, auxdataStyle);
  if (!auxdata) {
    throw Error('Auxdata is not in the bytecode');
  }

  // See more here: https://github.com/vyperlang/vyper/pull/3010
  if (auxdataStyle === AuxdataStyle.VYPER) {
    // cbor decode the object and get a json
    const cborDecodedObject = CBOR.decode(arrayify(`0x${auxdata}`));

    // Starting with version 0.3.10, Vyper stores the auxdata as an array
    // after 0.3.10: [runtimesize, datasize,immutablesize,version_cbor_object]
    // after 0.4.1: [integrity,runtimesize, datasize,immutablesize,version_cbor_object]
    // See more here: https://github.com/vyperlang/vyper/pull/3584
    if (cborDecodedObject instanceof Array) {
      // read the last element from array, it contains the compiler version
      const compilerVersion =
        cborDecodedObject[cborDecodedObject.length - 1].vyper.join('.');

      if (semver.gte(compilerVersion, '0.4.1')) {
        // Starting with version 0.4.1 Vyper added the integrity field
        // See more here: https://github.com/vyperlang/vyper/pull/4234
        return {
          integrity: cborDecodedObject[0],
          runtimeSize: cborDecodedObject[1],
          dataSizes: cborDecodedObject[2],
          immutableSize: cborDecodedObject[3],
          vyperVersion: compilerVersion,
        } as any;
      } else if (semver.gte(compilerVersion, '0.3.10')) {
        return {
          runtimeSize: cborDecodedObject[0],
          dataSizes: cborDecodedObject[1],
          immutableSize: cborDecodedObject[2],
          vyperVersion: compilerVersion,
        } as any;
      }
    }
    throw Error('This version of Vyper is not supported');
  } else if (
    auxdataStyle === AuxdataStyle.VYPER_LT_0_3_10 ||
    auxdataStyle === AuxdataStyle.VYPER_LT_0_3_5
  ) {
    // cbor decode the object and get a json
    const cborDecodedObject = CBOR.decode(arrayify(`0x${auxdata}`));
    return {
      vyperVersion: cborDecodedObject.vyper.join('.'),
    } as any;
  } else if (auxdataStyle === AuxdataStyle.SOLIDITY) {
    // cbor decode the object and get a json
    const cborDecodedObject = CBOR.decode(arrayify(`0x${auxdata}`));

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

    return result as any;
  } else {
    throw Error('Invalid auxdata style');
  }
};

/**
 * Splits the bytecode into execution bytecode and auxdata.
 * If the bytecode does not contain CBOR-encoded auxdata, returns the whole bytecode.
 *
 * @param bytecode - Hex string of the bytecode with 0x prefix
 * @param auxdataStyle - The style of auxdata (Solidity or Vyper)
 * @returns An array containing execution bytecode and optionally auxdata and its length
 */
export const splitAuxdata = (
  bytecode: string,
  auxdataStyle: AuxdataStyle,
): string[] => {
  validateBytecode(bytecode);
  bytecode = ensureHexPrefix(bytecode);

  // Fe has no CBOR metadata — return the full bytecode with no auxdata
  if (auxdataStyle === AuxdataStyle.FE) {
    return [bytecode];
  }

  const bytesLength = 4;
  const cborBytesLength = getCborBytesLength(
    bytecode,
    auxdataStyle,
    bytesLength,
  );

  if (isCborLengthInvalid(bytecode, cborBytesLength, bytesLength)) {
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
 * Validates that the bytecode is not empty.
 *
 * @param bytecode - The bytecode string to validate
 */
const validateBytecode = (bytecode: string) => {
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
const ensureHexPrefix = (bytecode: string): string => {
  return bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`;
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
    return 22;
  }
  const cborLengthHex = bytecode.slice(-bytesLength);
  return parseInt(cborLengthHex, 16) * 2;
};

/**
 * Checks if the CBOR length is invalid based on the bytecode length.
 *
 * @param bytecode - The complete bytecode string
 * @param cborBytesLength - The length of CBOR auxdata in bytes
 * @param bytesLength - The length of bytes used to encode the CBOR length
 * @returns True if the CBOR length is invalid, otherwise false
 */
const isCborLengthInvalid = (
  bytecode: string,
  cborBytesLength: number,
  bytesLength: number,
): boolean => {
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
  cborBytesLength: number,
  bytesLength: number,
): string => {
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
    CBOR.decode(arrayify(`0x${auxdata}`));
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
