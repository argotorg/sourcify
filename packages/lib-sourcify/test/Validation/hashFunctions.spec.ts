import { describe, it } from 'mocha';
import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ipfsHash } from '../../src/Validation/hashFunctions/ipfsHash';
import {
  swarmBzzr0Hash,
  swarmBzzr1Hash,
} from '../../src/Validation/hashFunctions/swarmHash';

// Reference values come from the Solidity compiler tests:
// https://github.com/argotorg/solidity/blob/develop/test/libsolutil/IpfsHash.cpp
// https://github.com/argotorg/solidity/blob/develop/test/libsolutil/SwarmHash.cpp
const IPFS_EMPTY_CID = 'QmbFMke1KXqnYyBBWxB74N4c5SBnJMVAiMNRcGu6x1AwQH';
const IPFS_HELLO_WORLD_CID = 'Qmf412jQZiuVUtdgnB36FXFX7xg5V6KEbSJ4dpQuhkLyfD';
const BZZR0_EMPTY_HASH =
  '0x011b4d03dd8c01f1049143cf9c4c817e4b167f1d1b83e5c6f0f10d89ba1e7bce';
// solc returns 32 zero bytes for empty input. This differs from the
// Swarm BMT address of an empty chunk.
const BZZR1_EMPTY_HASH = '0'.repeat(64);

const IPFS_HASH_MODULE = path.join(
  __dirname,
  '../../src/Validation/hashFunctions/ipfsHash',
);
const CHILD_PROCESS_TIMEOUT_MS = 10_000;

// A hang in ipfsHash is a synchronous loop that blocks the event loop.
// A mocha timeout cannot stop it, so the hash runs in a child process.
function ipfsHashInChildProcess(input: string): string {
  const script = `
    const { ipfsHash } = require(${JSON.stringify(IPFS_HASH_MODULE)});
    process.stdout.write(ipfsHash(${JSON.stringify(input)}));
  `;
  const result = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register', '-e', script],
    {
      cwd: path.join(__dirname, '../..'),
      encoding: 'utf8',
      env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' },
      timeout: CHILD_PROCESS_TIMEOUT_MS,
    },
  );
  if (result.error) {
    throw new Error(
      `ipfsHash(${JSON.stringify(input)}) did not return within ${CHILD_PROCESS_TIMEOUT_MS} ms: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `ipfsHash(${JSON.stringify(input)}) failed: ${result.stderr}`,
    );
  }
  return result.stdout;
}

describe('hashFunctions', () => {
  describe('ipfsHash', () => {
    it('should hash non-empty content', () => {
      expect(ipfsHash('hello world')).to.equal(IPFS_HELLO_WORLD_CID);
    });

    it('should hash empty content', () => {
      expect(ipfsHashInChildProcess('')).to.equal(IPFS_EMPTY_CID);
    });

    it('should hash whitespace-only content after trimEnd', () => {
      expect(ipfsHashInChildProcess('\n'.trimEnd())).to.equal(IPFS_EMPTY_CID);
    });
  });

  describe('swarmBzzr0Hash', () => {
    it('should hash empty content', () => {
      expect(swarmBzzr0Hash('')).to.equal(BZZR0_EMPTY_HASH);
    });
  });

  describe('swarmBzzr1Hash', () => {
    it('should hash empty content', () => {
      expect(swarmBzzr1Hash('')).to.equal(BZZR1_EMPTY_HASH);
    });

    it('should match the bzz-raw url that solc wrote into the metadata', () => {
      const dir = path.join(__dirname, '..', 'sources', 'Storage');
      const source = fs.readFileSync(
        path.join(dir, 'sources', 'Storage.sol'),
        'utf8',
      );
      const metadata = JSON.parse(
        fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'),
      );
      const bzzrUrl =
        metadata.sources['project:/contracts/Storage.sol'].urls[0];
      expect(bzzrUrl).to.equal(`bzz-raw://${swarmBzzr1Hash(source)}`);
    });

    // Reference values generated with @fairdatasociety/bmt-js 2.1.0
    const vectors: [string, string, string][] = [
      [
        'input smaller than one segment',
        'hello world',
        '92672a471f4419b255d7cb0cf313474a6f5856fb347c5ece85fb706d644b630f',
      ],
      [
        'exactly one chunk',
        'a'.repeat(4096),
        'e3b049dc6984e0f87dd32fd738dc42281044ffb1baf276ada67432b89e949c05',
      ],
      [
        'two chunks',
        'a'.repeat(4097),
        '04efeceb19c8ead5ba11a312dc5065e78a6e10a7e74a1a93682fc3555ed45ddf',
      ],
      [
        '129 chunks (carrier chunk)',
        'b'.repeat(4096 * 128 + 1),
        'b75df8f5f0896fb526aa369867cad8cc3355dee69291184cbe6e0ec351879edb',
      ],
      [
        '130 chunks',
        'c'.repeat(4096 * 129 + 5),
        'e377fae93af3f21e97e98d76a2fd8271eeeb0081937ca704ed26fbbc83d49e51',
      ],
    ];

    for (const [name, input, expected] of vectors) {
      it(`should hash ${name}`, () => {
        expect(swarmBzzr1Hash(input)).to.equal(expected);
      });
    }
  });
});
