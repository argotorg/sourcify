import { makeChunkedFile } from '@fairdatasociety/bmt-js';
import { keccak256 } from 'ethers';

export function swarmBzzr1Hash(file: string) {
  // convert file to Uint8Array
  const encoder = new TextEncoder();
  const fileBytes = encoder.encode(file);

  // Binary Merkle Tree on the file
  const chunkedFile = makeChunkedFile(fileBytes);

  // get the address from the chunked file
  const bytes = chunkedFile.address();

  // convert the address to hex string
  const hexByte = (n: number) => n.toString(16).padStart(2, '0');
  return Array.from(bytes, hexByte).join('');
}

function toLittleEndian(size: number): Uint8Array {
  const encoded = new Uint8Array(8);
  for (let i = 0; i < 8; ++i) {
    encoded[i] = (size >> (8 * i)) & 0xff;
  }
  return encoded;
}

function swarmHashSimple(data: Uint8Array, size: number): string {
  const combinedData = new Uint8Array([...toLittleEndian(size), ...data]);
  return keccak256(Buffer.from(combinedData.buffer));
}

function swarmHashIntermediate(
  input: Uint8Array,
  offset: number,
  length: number,
): string {
  let ref: Uint8Array;
  let innerNodes = new Uint8Array();

  if (length <= 0x1000) {
    ref = input.slice(offset, offset + length);
  } else {
    let maxRepresentedSize = 0x1000;
    while (maxRepresentedSize * (0x1000 / 32) < length) {
      maxRepresentedSize *= 0x1000 / 32;
    }

    for (let i = 0; i < length; i += maxRepresentedSize) {
      const size = Math.min(maxRepresentedSize, length - i);
      const innerNode = swarmHashIntermediate(input, offset + i, size);
      innerNodes = new Uint8Array([
        ...innerNodes,
        ...new Uint8Array(Buffer.from(innerNode, 'hex')),
      ]);
    }

    ref = innerNodes;
  }

  return swarmHashSimple(ref, length);
}

export function swarmBzzr0Hash(file: string): string {
  const encoder = new TextEncoder();
  const fileBytes = encoder.encode(file);
  return swarmHashIntermediate(fileBytes, 0, fileBytes.length);
}
