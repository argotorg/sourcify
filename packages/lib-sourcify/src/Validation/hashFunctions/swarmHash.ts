import { getBytes, keccak256 } from 'ethers';

const CHUNK_SIZE = 4096;
const SEGMENT_SIZE = 32;
const SEGMENTS_PER_CHUNK = CHUNK_SIZE / SEGMENT_SIZE;

interface Chunk {
  address: Uint8Array;
  span: number;
}

const hash = (bytes: Uint8Array) => getBytes(keccak256(bytes));

// 8 byte little endian span, lower 32 bits only
function makeSpan(length: number): Uint8Array {
  const span = new Uint8Array(8);
  new DataView(span.buffer).setUint32(0, length >>> 0, true);
  return span;
}

// Binary Merkle Tree root over the zero padded 4096 byte chunk
function bmtRootHash(payload: Uint8Array): Uint8Array {
  let level = new Uint8Array(CHUNK_SIZE);
  level.set(payload);
  while (level.length > SEGMENT_SIZE) {
    const next = new Uint8Array(level.length / 2);
    for (let i = 0; i < level.length; i += 2 * SEGMENT_SIZE) {
      next.set(hash(level.subarray(i, i + 2 * SEGMENT_SIZE)), i / 2);
    }
    level = next;
  }
  return level;
}

function makeChunk(payload: Uint8Array, span: number): Chunk {
  const input = new Uint8Array(8 + SEGMENT_SIZE);
  input.set(makeSpan(span));
  input.set(bmtRootHash(payload), 8);
  return { address: hash(input), span };
}

// A level with 128n + 1 chunks moves its last chunk to a higher level
function popCarrierChunk(chunks: Chunk[]): Chunk | null {
  if (chunks.length <= 1) return null;
  return chunks.length % SEGMENTS_PER_CHUNK === 1 ? chunks.pop()! : null;
}

function nextBmtLevel(chunks: Chunk[], carrier: Chunk | null) {
  const next: Chunk[] = [];
  for (let i = 0; i < chunks.length; i += SEGMENTS_PER_CHUNK) {
    const children = chunks.slice(i, i + SEGMENTS_PER_CHUNK);
    const payload = new Uint8Array(children.length * SEGMENT_SIZE);
    children.forEach((c, j) => payload.set(c.address, j * SEGMENT_SIZE));
    const span = children.reduce((sum, c) => sum + c.span, 0);
    next.push(makeChunk(payload, span));
  }
  if (carrier) {
    if (next.length % SEGMENTS_PER_CHUNK !== 0) {
      next.push(carrier);
      carrier = null;
    }
  } else {
    carrier = popCarrierChunk(next);
  }
  return { next, carrier };
}

export function swarmBzzr1Hash(file: string): string {
  const fileBytes = new TextEncoder().encode(file);

  // solc returns 32 zero bytes for empty input
  // https://github.com/argotorg/solidity/blob/develop/libsolutil/SwarmHash.cpp
  if (fileBytes.length === 0) {
    return '0'.repeat(64);
  }

  let chunks: Chunk[] = [];
  for (let i = 0; i < fileBytes.length; i += CHUNK_SIZE) {
    const payload = fileBytes.subarray(i, i + CHUNK_SIZE);
    chunks.push(makeChunk(payload, payload.length));
  }

  let carrier = popCarrierChunk(chunks);
  while (chunks.length !== 1 || carrier) {
    ({ next: chunks, carrier } = nextBmtLevel(chunks, carrier));
  }

  const hexByte = (n: number) => n.toString(16).padStart(2, '0');
  return Array.from(chunks[0].address, hexByte).join('');
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
