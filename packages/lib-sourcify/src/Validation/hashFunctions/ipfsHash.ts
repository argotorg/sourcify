// This is a ChatGPT typescript translation of the file https://github.com/ethereum/solidity/blob/develop/libsolutil/IpfsHash.cpp

import bs58 from 'bs58';
import * as crypto from 'crypto';

interface Link {
  hash: Buffer;
  size: number;
  blockSize: number;
}

function varintEncoding(n: number) {
  const encoded = [];
  while (n > 0x7f) {
    encoded.push(0x80 | (n & 0x7f));
    n >>= 7;
  }
  encoded.push(n);
  return Buffer.from(encoded);
}

function encodeByteArray(data: Buffer) {
  return Buffer.concat([
    Buffer.from([0x0a]),
    varintEncoding(data.length),
    data,
  ]);
}

function encodeHash(data: Buffer) {
  return Buffer.concat([
    Buffer.from([0x12, 0x20]),
    crypto.createHash('sha256').update(data).digest(),
  ]);
}

function encodeLinkData(data: Buffer) {
  return Buffer.concat([
    Buffer.from([0x12]),
    varintEncoding(data.length),
    data,
  ]);
}

function base58Encode(data: Buffer) {
  return bs58.encode(data);
}

function combineLinks(links: Link[]) {
  let data = Buffer.alloc(0);
  let lengths = Buffer.alloc(0);
  const chunk = {
    hash: Buffer.alloc(0),
    size: 0,
    blockSize: 0,
  };

  for (const link of links) {
    chunk.size += link.size;
    chunk.blockSize += link.blockSize;

    data = Buffer.concat([
      data,
      encodeLinkData(
        Buffer.concat([
          Buffer.from([0x0a]),
          varintEncoding(link.hash.length),
          link.hash,
          Buffer.from([0x12, 0x00, 0x18]),
          varintEncoding(link.blockSize),
        ]),
      ),
    ]);

    lengths = Buffer.concat([
      lengths,
      Buffer.from([0x20]),
      varintEncoding(link.size),
    ]);
  }

  const blockData = Buffer.concat([
    data,
    encodeByteArray(
      Buffer.concat([
        Buffer.from([0x08, 0x02, 0x18]),
        varintEncoding(chunk.size),
        lengths,
      ]),
    ),
  ]);

  chunk.blockSize += blockData.length;
  chunk.hash = encodeHash(blockData);

  return chunk;
}

function buildNextLevel(currentLevel: Link[]) {
  const maxChildNum = 174;
  const nextLevel = [];
  const links = [];

  for (const chunk of currentLevel) {
    links.push({
      hash: chunk.hash,
      size: chunk.size,
      blockSize: chunk.blockSize,
    });

    if (links.length === maxChildNum) {
      nextLevel.push(combineLinks(links));
      links.length = 0;
    }
  }

  if (links.length > 0) {
    nextLevel.push(combineLinks(links));
  }

  return nextLevel;
}

function groupChunksBottomUp(currentLevel: Link[]) {
  while (currentLevel.length !== 1) {
    currentLevel = buildNextLevel(currentLevel);
  }

  return currentLevel[0].hash;
}

function ipfsHashData(data: Uint8Array) {
  const maxChunkSize = 1024 * 256;
  const chunkCount = Math.ceil(data.length / maxChunkSize);

  const allChunks = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const chunkBytes = Buffer.from(
      data.slice(chunkIndex * maxChunkSize, (chunkIndex + 1) * maxChunkSize),
    );

    const lengthAsVarint = varintEncoding(chunkBytes.length);

    let protobufEncodedData = Buffer.concat([Buffer.from([0x08, 0x02])]);
    if (chunkBytes.length > 0) {
      protobufEncodedData = Buffer.concat([
        protobufEncodedData,
        Buffer.from([0x12]),
        lengthAsVarint,
        chunkBytes,
      ]);
    }
    protobufEncodedData = Buffer.concat([
      protobufEncodedData,
      Buffer.from([0x18]),
      lengthAsVarint,
    ]);

    const blockData = encodeByteArray(protobufEncodedData);

    allChunks.push({
      hash: encodeHash(blockData),
      size: chunkBytes.length,
      blockSize: blockData.length,
    });
  }

  return groupChunksBottomUp(allChunks);
}

function ipfsHashBase58(data: Uint8Array): string {
  return base58Encode(ipfsHashData(data));
}

export function ipfsHash(str: string) {
  const buffer = new TextEncoder().encode(str);
  return ipfsHashBase58(buffer);
}
