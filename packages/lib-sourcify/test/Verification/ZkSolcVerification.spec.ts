import { describe, it } from 'mocha';
import { expect } from 'chai';
import { Verification } from '../../src/Verification/Verification';
import {
  ZkSolcVerification,
  decodeContractDeployerCalldata,
} from '../../src/Verification/ZkSolcVerification';
import { ZkSolcCompilation } from '../../src/Compilation/ZkSolcCompilation';
import { eraBytecodeHash } from '@ethereum-sourcify/bytecode-utils';
import {
  ABSTRACT_ZKSYNC_1_3_19_TAIL,
  ABSTRACT_ZKSYNC_1_5_7_TAIL,
  ABSTRACT_ZKSYNC_1_5_15_TAIL,
  compilationTarget,
  makeCompiler,
  makeContract,
  makeDeployerCalldata,
  makeJsonInput,
  replaceHex,
  strip0x,
} from '../utils/zksolcTestHelpers';

// Unit tests for EraVM (zksolc) verification/matching against synthetic on-chain
// bytecode and a mock chain — no network. The live-RPC counterpart lives in
// ZkSolcVerification.e2e.spec.ts.
describe('ZkSolcVerification (EraVM matching, unit)', () => {
  describe('runtime matching', () => {
    // Recompiled bytecode == on-chain bytecode (mock), so these are perfect
    // runtime matches; creation is null because the mock chain has no creation tx.
    for (const sample of [
      {
        address: '0xbc176ac2373614f9858a118917d83b139bcb3f8c',
        zksolcVersion: '1.5.7',
        solcVersion: '0.8.26-1.0.1',
        bytecode: ABSTRACT_ZKSYNC_1_5_7_TAIL,
        auxdataOffset: 224,
      },
      {
        address: '0x4f7589c619d59443db52489dd375de63e03e671d',
        zksolcVersion: '1.3.19',
        solcVersion: 'v0.6.12+commit.27d51765',
        bytecode: ABSTRACT_ZKSYNC_1_3_19_TAIL,
        auxdataOffset: 192,
      },
      {
        address: '0x0929d81a73a83b73e5de2ba63a15ce2a18addbe2',
        zksolcVersion: '1.5.15',
        solcVersion: '0.8.26-1.0.2',
        bytecode: ABSTRACT_ZKSYNC_1_5_15_TAIL,
        auxdataOffset: 128,
      },
    ]) {
      it(`perfectly matches Abstract EraVM bytecode sample ${sample.address}`, async () => {
        const compiler = makeCompiler(
          makeContract({
            evm: {
              bytecode: {
                object: strip0x(sample.bytecode),
              },
              deployedBytecode: {
                object: '',
              },
            },
          }),
        );
        const compilation = new ZkSolcCompilation(
          compiler,
          `zksolc:${sample.zksolcVersion};solc:${sample.solcVersion}`,
          makeJsonInput(),
          compilationTarget,
        );
        const verification = new Verification(
          compilation,
          {
            chainId: 2741,
            async getBytecode() {
              return sample.bytecode;
            },
          } as any,
          sample.address,
        );

        await verification.verify();

        expect(verification.status.runtimeMatch).to.equal('perfect');
        expect(verification.status.creationMatch).to.equal(null);
        expect(
          verification.export().compilation.runtimeBytecodeCborAuxdata,
        ).to.deep.equal({
          '1': {
            offset: sample.auxdataOffset,
            value: `0x${strip0x(sample.bytecode).slice(
              sample.auxdataOffset * 2,
            )}`,
          },
        });
      });
    }

    it('partially matches when only the CBOR metadata differs', async () => {
      const onchainBytecode = replaceHex(
        ABSTRACT_ZKSYNC_1_5_15_TAIL,
        '07a4f6fd',
        '08a4f6fd',
      );
      const compiler = makeCompiler(
        makeContract({
          evm: {
            bytecode: {
              object: strip0x(ABSTRACT_ZKSYNC_1_5_15_TAIL),
            },
            deployedBytecode: {
              object: '',
            },
          },
        }),
      );
      const compilation = new ZkSolcCompilation(
        compiler,
        'zksolc:1.5.15;solc:0.8.26-1.0.2',
        makeJsonInput(),
        compilationTarget,
      );
      const verification = new Verification(
        compilation,
        {
          chainId: 2741,
          async getBytecode() {
            return onchainBytecode;
          },
        } as any,
        '0x0929d81a73a83b73e5de2ba63a15ce2a18addbe2',
      );

      await verification.verify();

      expect(verification.status.runtimeMatch).to.equal('partial');
      expect(verification.transformations.runtime?.list).to.deep.equal([
        {
          type: 'replace',
          reason: 'cborAuxdata',
          offset: 128,
          id: '1',
        },
      ]);
    });

    it('partially matches when only the bare metadata hash differs', async () => {
      const onchainBytecode = replaceHex(
        ABSTRACT_ZKSYNC_1_3_19_TAIL,
        '7e803832',
        '7f803832',
      );
      const compiler = makeCompiler(
        makeContract({
          evm: {
            bytecode: {
              object: strip0x(ABSTRACT_ZKSYNC_1_3_19_TAIL),
            },
            deployedBytecode: {
              object: '',
            },
          },
        }),
      );
      const compilation = new ZkSolcCompilation(
        compiler,
        'zksolc:1.3.19;solc:v0.6.12+commit.27d51765',
        makeJsonInput(),
        compilationTarget,
      );
      const verification = new Verification(
        compilation,
        {
          chainId: 2741,
          async getBytecode() {
            return onchainBytecode;
          },
        } as any,
        '0x4f7589c619d59443db52489dd375de63e03e671d',
      );

      await verification.verify();

      expect(verification.status.runtimeMatch).to.equal('partial');
      expect(verification.transformations.runtime?.list).to.deep.equal([
        {
          type: 'replace',
          reason: 'cborAuxdata',
          offset: 192,
          id: '1',
        },
      ]);
    });
  });

  describe('creation matching', () => {
    const address = '0x2dae3b08e3daedf619e68c99f3e7f3c9608e0095';

    // ZKsync ContractDeployer system contract; a direct deploy sends the creation
    // tx to this address.
    const SYSTEM_CONTRACT_DEPLOYER_ADDRESS =
      '0x0000000000000000000000000000000000008006';

    function makeChain(
      runtime: string,
      creationBytecode: string,
      creationTxTo: string = SYSTEM_CONTRACT_DEPLOYER_ADDRESS,
    ) {
      return {
        chainId: 2741,
        async getBytecode() {
          return `0x${runtime}`;
        },
        async getTx() {
          return {
            blockNumber: 1,
            from: '0x0000000000000000000000000000000000000001',
            to: creationTxTo,
          };
        },
        async getContractCreationBytecodeAndReceipt() {
          return { creationBytecode, txReceipt: { index: 0 } };
        },
      } as any;
    }

    function makeRuntimeCompilation(runtime: string) {
      const compiler = makeCompiler(
        makeContract({
          evm: {
            bytecode: { object: runtime },
            deployedBytecode: { object: '' },
          },
        }),
      );
      return new ZkSolcCompilation(
        compiler,
        'zksolc:1.5.7;solc:0.8.26-1.0.1',
        makeJsonInput(),
        compilationTarget,
      );
    }

    it('matches creation via the versioned bytecode hash and inherits the runtime match type', async () => {
      const runtime = 'aa'.repeat(32);
      const compilation = makeRuntimeCompilation(runtime);
      const calldata = makeDeployerCalldata(eraBytecodeHash(`0x${runtime}`));
      const verification = new ZkSolcVerification(
        compilation,
        makeChain(runtime, calldata),
        address,
        '0xcreationtx',
      );

      await verification.verify();

      // The recompiled hash matches the one in the creation calldata, so creation
      // matches — and it inherits the runtime match type rather than being graded
      // on its own.
      expect(verification.status.runtimeMatch).to.equal('perfect');
      expect(verification.status.creationMatch).to.equal('perfect');
    });

    it('does not match creation when the calldata references a different bytecode hash', async () => {
      const runtime = 'aa'.repeat(32);
      const compilation = makeRuntimeCompilation(runtime);
      const calldata = makeDeployerCalldata(
        eraBytecodeHash(`0x${'bb'.repeat(32)}`),
      );
      const verification = new ZkSolcVerification(
        compilation,
        makeChain(runtime, calldata),
        address,
        '0xcreationtx',
      );

      await verification.verify();

      expect(verification.status.runtimeMatch).to.equal('perfect');
      expect(verification.status.creationMatch).to.equal(null);
    });

    it('does not match creation when the deploy tx does not target the ContractDeployer', async () => {
      const runtime = 'aa'.repeat(32);
      const compilation = makeRuntimeCompilation(runtime);
      const calldata = makeDeployerCalldata(eraBytecodeHash(`0x${runtime}`));
      const verification = new ZkSolcVerification(
        compilation,
        // Creation tx routed through a factory, not the ContractDeployer directly.
        makeChain(
          runtime,
          calldata,
          '0x00000000000000000000000000000000000f4c70',
        ),
        address,
        '0xcreationtx',
      );

      await verification.verify();

      expect(verification.status.runtimeMatch).to.equal('perfect');
      expect(verification.status.creationMatch).to.equal(null);
    });
  });

  describe('decodeContractDeployerCalldata', () => {
    it('decodes the bytecode hash and the ABI-encoded constructor args', () => {
      const hashHex = '11'.repeat(32);
      const encodedAddress = `000000000000000000000000${'cd'.repeat(20)}`;
      const calldata = makeDeployerCalldata(`0x${hashHex}`, encodedAddress);
      expect(decodeContractDeployerCalldata(calldata)).to.deep.equal({
        bytecodeHash: `0x${hashHex}`,
        constructorArguments: `0x${encodedAddress}`,
      });
    });

    it('returns null for calldata that is not a ContractDeployer deploy', () => {
      expect(
        decodeContractDeployerCalldata(`0xdeadbeef${'00'.repeat(64)}`),
      ).to.equal(null);
    });
  });
});
