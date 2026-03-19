import { describe, it, before, after } from 'mocha';
import { use } from 'chai';
import { Verification } from '../../src/Verification/Verification';
import type { ChildProcess } from 'child_process';
import { type JsonRpcSigner } from 'ethers';
import path from 'path';
import { deployFeContract, expectVerification, feCompiler } from '../utils';
import {
  startHardhatNetwork,
  stopHardhatNetwork,
} from '../hardhat-network-helper';
import fs from 'fs';
import { FeCompilation } from '../../src/Compilation/FeCompilation';
import chaiAsPromised from 'chai-as-promised';
import { SourcifyChain, SourcifyLibError } from '../../src';

use(chaiAsPromised);

const FE_COUNTER_FOLDER = path.join(
  __dirname,
  '..',
  'sources',
  'Fe',
  'counter',
);

const FE_MULTI_FILE_FOLDER = path.join(
  __dirname,
  '..',
  'sources',
  'Fe',
  'multi_file',
);

const HARDHAT_PORT = 8545;

const hardhatChain = {
  name: 'Hardhat Network Localhost',
  shortName: 'Hardhat Network',
  chainId: 31337,
  faucets: [],
  infoURL: 'localhost',
  nativeCurrency: { name: 'localETH', symbol: 'localETH', decimals: 18 },
  network: 'testnet',
  networkId: 31337,
  rpcs: [
    {
      rpc: `http://localhost:${HARDHAT_PORT}`,
    },
  ],
  supported: true,
};

const sourcifyChain: SourcifyChain = new SourcifyChain(hardhatChain);

describe('FeVerification', () => {
  let hardhatNodeProcess: ChildProcess;
  let signer: JsonRpcSigner;

  before(async () => {
    hardhatNodeProcess = await startHardhatNetwork(HARDHAT_PORT);
    signer = await sourcifyChain.rpcs[0].provider!.getSigner();
  });

  after(async () => {
    await stopHardhatNetwork(hardhatNodeProcess);
  });

  describe('Single-file Fe contract', () => {
    it('should verify Counter with partial runtime and creation match', async () => {
      const artifact = JSON.parse(
        fs.readFileSync(path.join(FE_COUNTER_FOLDER, 'artifact.json'), 'utf8'),
      );
      const counterSource = fs.readFileSync(
        path.join(FE_COUNTER_FOLDER, 'lib.fe'),
        'utf8',
      );

      const { contractAddress, txHash } = await deployFeContract(
        signer,
        artifact.creationBytecode,
      );

      const compilation = new FeCompilation(
        feCompiler,
        '26.0.0-alpha.10',
        {
          language: 'Fe',
          sources: {
            'src/lib.fe': { content: counterSource },
          },
        },
        { name: 'Counter', path: 'src/lib.fe' },
      );

      const verification = new Verification(
        compilation,
        sourcifyChain,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: { runtimeMatch: 'partial', creationMatch: 'partial' },
      });
    });

    it('should fail verification with wrong source (no_match)', async () => {
      const artifact = JSON.parse(
        fs.readFileSync(path.join(FE_COUNTER_FOLDER, 'artifact.json'), 'utf8'),
      );

      const { contractAddress, txHash } = await deployFeContract(
        signer,
        artifact.creationBytecode,
      );

      // A valid Fe Counter contract but with different runtime logic (increments by 2 instead of 1)
      // — compiles successfully but produces different runtime bytecodes
      const wrongSource = `use std::abi::sol
use std::evm::{Evm, Call}
use std::evm::effects::assert

msg CounterMsg {
    #[selector = sol("increment()")]
    Increment,
    #[selector = sol("get()")]
    Get -> u256,
}

struct CounterStore {
    value: u256,
}

pub contract Counter {
    mut store: CounterStore

    init() uses (mut store) {
        store.value = 0
    }

    recv CounterMsg {
        Increment uses (mut store) {
            store.value = store.value + 2
        }

        Get -> u256 uses (store) {
            store.value
        }
    }
}`;

      const compilation = new FeCompilation(
        feCompiler,
        '26.0.0-alpha.10',
        {
          language: 'Fe',
          sources: {
            'src/lib.fe': { content: wrongSource },
          },
        },
        { name: 'Counter', path: 'src/lib.fe' },
      );

      const verification = new Verification(
        compilation,
        sourcifyChain,
        contractAddress,
        txHash,
      );

      let threw = false;
      try {
        await verification.verify();
      } catch (e) {
        threw = true;
        if (e instanceof SourcifyLibError) {
          if (e.code !== 'no_match') {
            throw new Error(
              `Expected SourcifyLibError with code 'no_match' but got '${e.code}'`,
            );
          }
        } else {
          throw e;
        }
      }
      if (!threw) {
        throw new Error('Expected verification to throw but it did not');
      }
    });
  });

  describe('Multi-file Fe ingot', () => {
    it('should verify Counter defined in src/counter.fe with partial match', async () => {
      const artifact = JSON.parse(
        fs.readFileSync(
          path.join(FE_MULTI_FILE_FOLDER, 'artifact.json'),
          'utf8',
        ),
      );
      const libFeSource = fs.readFileSync(
        path.join(FE_MULTI_FILE_FOLDER, 'src', 'lib.fe'),
        'utf8',
      );
      const counterFeSource = fs.readFileSync(
        path.join(FE_MULTI_FILE_FOLDER, 'src', 'counter.fe'),
        'utf8',
      );

      const { contractAddress, txHash } = await deployFeContract(
        signer,
        artifact.creationBytecode,
      );

      const compilation = new FeCompilation(
        feCompiler,
        '26.0.0-alpha.10',
        {
          language: 'Fe',
          sources: {
            'src/lib.fe': { content: libFeSource },
            'src/counter.fe': { content: counterFeSource },
          },
        },
        { name: 'Counter', path: 'src/counter.fe' },
      );

      const verification = new Verification(
        compilation,
        sourcifyChain,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: { runtimeMatch: 'partial', creationMatch: 'partial' },
      });
    });
  });
});
