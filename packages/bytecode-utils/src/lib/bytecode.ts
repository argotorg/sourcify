import { getBytes } from 'ethers';
import * as CBOR from 'cbor-x';
import semver from 'semver';

import {
  AuxdataStyle,
  decodeSolidityCborObject,
  ensureHexPrefix,
  splitCborAuxdata,
  validateBytecode,
  type SolidityDecodedObject,
} from './cbor';
import { decodeEraVmAuxdata, splitEraVmAuxdata } from './eravm';

// Re-export the public CBOR API so it stays available from the package root.
export { AuxdataStyle, isCborEncoded } from './cbor';
export type { SolidityDecodedObject } from './cbor';

type CBOR = {
  bytes: string;
  length: number;
};

export type VyperDecodedObject = {
  integrity?: string;
  runtimeSize?: number;
  dataSizes?: number[];
  immutableSize?: number;
  vyperVersion: string;
};

export const getVyperAuxdataStyle = (
  compilerVersion: string,
):
  | AuxdataStyle.VYPER_LT_0_3_4
  | AuxdataStyle.VYPER_LT_0_3_5
  | AuxdataStyle.VYPER_LT_0_3_10
  | AuxdataStyle.VYPER => {
  const coercedVersion = semver.coerce(compilerVersion);
  if (!coercedVersion) {
    throw Error(`Invalid Vyper compiler version: ${compilerVersion}`);
  }

  const version = coercedVersion.version;
  // Vyper versions < 0.3.4 emit no CBOR auxdata at all.
  if (semver.lt(version, '0.3.4')) {
    return AuxdataStyle.VYPER_LT_0_3_4;
  }
  // Only 0.3.4 uses the fixed-length 22-byte CBOR format.
  if (semver.lt(version, '0.3.5')) {
    return AuxdataStyle.VYPER_LT_0_3_5;
  }
  if (semver.lt(version, '0.3.10')) {
    return AuxdataStyle.VYPER_LT_0_3_10;
  }
  return AuxdataStyle.VYPER;
};

export const getAuxdataStyle = (
  language: string,
  compilerVersion?: string,
): AuxdataStyle => {
  switch (language.toLowerCase()) {
    case 'solidity':
    case 'yul':
      return AuxdataStyle.SOLIDITY;
    case 'vyper':
      if (!compilerVersion) {
        throw Error(
          'Vyper compiler version is required to determine auxdata style',
        );
      }
      return getVyperAuxdataStyle(compilerVersion);
    case 'fe':
      return AuxdataStyle.FE;
    default:
      throw Error(`Unsupported language for auxdata style: ${language}`);
  }
};

/**
 * Decode contract's bytecode
 * @param bytecode - hex of the bytecode with 0x prefix
 * @param auxdataStyle - The style of auxdata, check AuxdataStyle enum for more info
 * @returns Object describing the contract
 */
export const decode = <T extends AuxdataStyle>(
  bytecode: string,
  auxdataStyle: T,
): T extends AuxdataStyle.SOLIDITY | AuxdataStyle.ZKSYNC
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
    const cborDecodedObject = CBOR.decode(getBytes(`0x${auxdata}`));

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
    const cborDecodedObject = CBOR.decode(getBytes(`0x${auxdata}`));
    return {
      vyperVersion: cborDecodedObject.vyper.join('.'),
    } as any;
  } else if (auxdataStyle === AuxdataStyle.SOLIDITY) {
    return decodeSolidityCborObject(auxdata) as any;
  } else if (auxdataStyle === AuxdataStyle.ZKSYNC) {
    return decodeEraVmAuxdata(auxdata) as any;
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
): [string, string?, string?] => {
  validateBytecode(bytecode);
  bytecode = ensureHexPrefix(bytecode);

  // FE and Vyper < 0.3.4 have no CBOR metadata — return the full bytecode with no auxdata
  if (
    auxdataStyle === AuxdataStyle.FE ||
    auxdataStyle === AuxdataStyle.VYPER_LT_0_3_4
  ) {
    return [bytecode];
  }

  if (auxdataStyle === AuxdataStyle.ZKSYNC) {
    return splitEraVmAuxdata(bytecode);
  }

  return splitCborAuxdata(bytecode, auxdataStyle);
};
