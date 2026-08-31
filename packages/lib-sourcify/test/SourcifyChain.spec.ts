import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chai from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { DefinitiveError, RpcFailure, SourcifyChain } from '../src';
import { JsonRpcProvider } from 'ethers';
import {
  startHardhatNetwork,
  stopHardhatNetwork,
} from '@ethereum-sourcify/test-helpers';
import type { ChildProcess } from 'child_process';

chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('SourcifyChain', () => {
  let sourcifyChain: SourcifyChain;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sourcifyChain = new SourcifyChain({
      name: 'TestChain',
      chainId: 1,
      rpcs: [
        {
          rpc: 'http://localhost:8545',
          traceSupport: 'trace_transaction',
        },
      ],
      supported: true,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getContractCreationBytecodeAndReceipt', () => {
    it('should return the tx input data for a directly deployed contract, matching the address case-insensitively', async () => {
      sandbox
        .stub(sourcifyChain, 'getTxReceipt')
        .resolves({ contractAddress: '0xAddress' } as any);
      sandbox
        .stub(sourcifyChain, 'getTx')
        .resolves({ data: '0xcreationBytecode' } as any);

      const { creationBytecode } =
        await sourcifyChain.getContractCreationBytecodeAndReceipt(
          '0xaddress',
          '0xhash',
        );
      expect(creationBytecode).to.equal('0xcreationBytecode');
    });

    // https://github.com/argotorg/sourcify/issues/2932
    it('should fall back to traces when the tx deploys another contract whose constructor creates the verified one', async () => {
      sandbox
        .stub(sourcifyChain, 'getTxReceipt')
        .resolves({ contractAddress: '0xtokenAddress' } as any);
      sandbox
        .stub(sourcifyChain, 'getTx')
        .resolves({ data: '0xtokenCreationBytecode' } as any);
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'create',
          result: { address: '0xtokenAddress' },
          action: { init: '0xtokenCreationBytecode' },
        },
        {
          type: 'create',
          result: { address: '0xpairAddress' },
          action: { init: '0xpairCreationBytecode' },
        },
      ]);

      const { creationBytecode } =
        await sourcifyChain.getContractCreationBytecodeAndReceipt(
          '0xpairAddress',
          '0xhash',
        );
      expect(creationBytecode).to.equal('0xpairCreationBytecode');
      expect(mockProvider.send).to.have.been.calledWith('trace_transaction', [
        '0xhash',
      ]);
    });

    // https://github.com/argotorg/sourcify/issues/887
    it('should reject after a single trace fetch when the traces show the tx did not create the verified contract', async () => {
      (sourcifyChain as any).rpcs = [
        {
          rpc: 'http://localhost:8545',
          traceSupport: 'trace_transaction',
          provider: new JsonRpcProvider('http://localhost:8545'),
        },
        {
          rpc: 'http://localhost:8546',
          traceSupport: 'trace_transaction',
          provider: new JsonRpcProvider('http://localhost:8546'),
        },
      ];
      sandbox
        .stub(sourcifyChain, 'getTxReceipt')
        .resolves({ contractAddress: '0xtokenAddress' } as any);
      sandbox
        .stub(sourcifyChain, 'getTx')
        .resolves({ data: '0xtokenCreationBytecode' } as any);
      const traceWithoutPair = [
        {
          type: 'create',
          result: { address: '0xtokenAddress' },
          action: { init: '0xtokenCreationBytecode' },
        },
      ];
      const sendStub1 = sandbox
        .stub(sourcifyChain.rpcs[0].provider!, 'send')
        .resolves(traceWithoutPair);
      const sendStub2 = sandbox
        .stub(sourcifyChain.rpcs[1].provider!, 'send')
        .resolves(traceWithoutPair);

      await expect(
        sourcifyChain.getContractCreationBytecodeAndReceipt(
          '0xpairAddress',
          '0xhash',
        ),
      ).to.be.rejectedWith(
        'Provided tx 0xhash does not create the expected contract 0xpairAddress',
      );
      // The answer is definitive, so the second trace RPC is never asked
      expect(sendStub1).to.have.been.calledOnce;
      expect(sendStub2).to.not.have.been.called;
    });

    it('should throw when the tx directly created a different contract and the chain has no trace support', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpcs: [{ rpc: 'http://localhost:8545' }],
        supported: true,
      });
      sandbox
        .stub(sourcifyChain, 'getTxReceipt')
        .resolves({ contractAddress: '0xtokenAddress' } as any);
      sandbox
        .stub(sourcifyChain, 'getTx')
        .resolves({ data: '0xtokenCreationBytecode' } as any);

      await expect(
        sourcifyChain.getContractCreationBytecodeAndReceipt(
          '0xpairAddress',
          '0xhash',
        ),
      ).to.be.rejectedWith(
        "Transaction 0xhash directly created contract 0xtokenAddress, not the contract being verified 0xpairAddress. Either the transaction hash is wrong or the contract was created by an internal transaction, which can't be checked because chain 1 doesn't have trace support",
      );
    });

    it('should throw for a factory-created contract without trace support', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpcs: [{ rpc: 'http://localhost:8545' }],
        supported: true,
      });
      sandbox
        .stub(sourcifyChain, 'getTxReceipt')
        .resolves({ contractAddress: null } as any);
      sandbox
        .stub(sourcifyChain, 'getTx')
        .resolves({ data: '0xfactoryCallData' } as any);

      await expect(
        sourcifyChain.getContractCreationBytecodeAndReceipt(
          '0xaddress',
          '0xhash',
        ),
      ).to.be.rejectedWith(
        'No trace support for chain 1. No other method to get the creation bytecode',
      );
    });
  });

  describe('getCreationBytecodeForFactory', () => {
    it('should throw an error if trace support is not available', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpcs: [
          {
            rpc: 'http://localhost:8545',
          },
        ],
        supported: true,
      });
      await expect(
        sourcifyChain.getCreationBytecodeForFactory('0xhash', '0xaddress'),
      ).to.be.rejectedWith(
        'No trace support for chain 1. No other method to get the data',
      );
    });

    it('should extract creation bytecode from parity traces', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'create',
          result: { address: '0xaddress' },
          action: { init: '0xcreationBytecode' },
        },
      ]);

      const result = await sourcifyChain.getCreationBytecodeForFactory(
        '0xhash',
        '0xaddress',
      );
      expect(result).to.equal('0xcreationBytecode');
      expect(mockProvider.send).to.have.been.calledWith('trace_transaction', [
        '0xhash',
      ]);
    });

    it('should throw an error if no create trace is found in parity traces', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox
        .stub(mockProvider, 'send')
        .resolves([{ type: 'call' }, { type: 'suicide' }]);

      // The definitive error surfaces directly instead of a generic "All RPCs failed"
      await expect(
        sourcifyChain.getCreationBytecodeForFactory('0xhash', '0xaddress'),
      ).to.be.rejectedWith(
        'Provided tx 0xhash does not create the expected contract 0xaddress',
      );
    });

    it('should try multiple trace-supported RPCs if the first one fails', async () => {
      (sourcifyChain as any).rpcs = [
        {
          rpc: 'http://localhost:8545',
          traceSupport: 'trace_transaction',
          provider: new JsonRpcProvider('http://localhost:8545'),
        },
        {
          rpc: 'http://localhost:8546',
          traceSupport: 'trace_transaction',
          provider: new JsonRpcProvider('http://localhost:8546'),
        },
      ];

      const mockProvider1 = sourcifyChain.rpcs[0].provider!;
      const mockProvider2 = sourcifyChain.rpcs[1].provider!;

      sandbox.stub(mockProvider1, 'send').rejects(new Error('RPC error'));
      sandbox.stub(mockProvider2, 'send').resolves([
        {
          type: 'create',
          result: { address: '0xaddress' },
          action: { init: '0xcreationBytecode' },
        },
      ]);

      const result = await sourcifyChain.getCreationBytecodeForFactory(
        '0xhash',
        '0xaddress',
      );
      expect(result).to.equal('0xcreationBytecode');
      expect(mockProvider1.send).to.have.been.called;
      expect(mockProvider2.send).to.have.been.called;
    });

    it('should extract creation bytecode from geth traces', async () => {
      (sourcifyChain as any).rpcs = [
        {
          rpc: 'http://localhost:8545',
          traceSupport: 'debug_traceTransaction',
          provider: new JsonRpcProvider('http://localhost:8545'),
        },
      ];
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({
        type: 'CALL',
        to: '0xfactoryAddress',
        calls: [
          {
            type: 'CREATE',
            to: '0xaddress',
            input: '0xcreationBytecode',
          },
        ],
      });

      const result = await sourcifyChain.getCreationBytecodeForFactory(
        '0xhash',
        '0xaddress',
      );
      expect(result).to.equal('0xcreationBytecode');
      expect(mockProvider.send).to.have.been.calledWith(
        'debug_traceTransaction',
        ['0xhash', { tracer: 'callTracer' }],
      );
    });

    it('should throw an error if no CREATE or CREATE2 calls are found in geth traces', async () => {
      (sourcifyChain as any).rpcs = [
        {
          rpc: 'http://localhost:8545',
          traceSupport: 'debug_traceTransaction',
          provider: new JsonRpcProvider('http://localhost:8545'),
        },
      ];
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({
        type: 'CALL',
        to: '0xcalledAddress',
        calls: [
          {
            type: 'CALL',
            to: '0xsomeaddress',
            input: '0xsomeinput',
          },
        ],
      });

      await expect(
        sourcifyChain.getCreationBytecodeForFactory('0xhash', '0xaddress'),
      ).to.be.rejected;
    });

    it('should throw an error if the contract address is not found in geth traces', async () => {
      (sourcifyChain as any).rpcs = [
        {
          rpc: 'http://localhost:8545',
          traceSupport: 'debug_traceTransaction',
          provider: new JsonRpcProvider('http://localhost:8545'),
        },
      ];
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({
        type: 'CALL',
        to: '0xfactoryAddress',
        calls: [
          {
            type: 'CREATE',
            to: '0xdifferentaddress',
            input: '0xcreationBytecode',
          },
        ],
      });

      // The definitive error surfaces directly instead of a generic "All RPCs failed"
      await expect(
        sourcifyChain.getCreationBytecodeForFactory('0xhash', '0xaddress'),
      ).to.be.rejectedWith(
        'No CREATE or CREATE2 call found for the address 0xaddress',
      );
    });
  });

  describe('getCreatedAddressesFromBlockTraces', () => {
    it('should throw an error if trace support is not available', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpcs: [
          {
            rpc: 'http://localhost:8545',
          },
        ],
        supported: true,
      });
      await expect(
        sourcifyChain.getCreatedAddressesFromBlockTraces(12345),
      ).to.be.rejectedWith(
        'No trace support for chain 1. No other method to get the data',
      );
    });

    it('should extract created addresses from parity traces', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'create',
          result: { address: '0xaddress' },
          action: { init: '0xcreationBytecode' },
          transactionHash: '0xhash',
        },
      ]);

      const result =
        await sourcifyChain.getCreatedAddressesFromBlockTraces(12345);
      expect(result).to.deep.equal({ '0xhash': ['0xaddress'] });
      expect(mockProvider.send).to.have.been.calledWith('trace_block', [
        '0x3039',
      ]);
    });

    it('should extract created addresses from geth traces', async () => {
      (sourcifyChain as any).rpcs = [
        {
          rpc: 'http://localhost:8545',
          traceSupport: 'debug_traceTransaction',
          provider: new JsonRpcProvider('http://localhost:8545'),
        },
      ];
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          txHash: '0xhash',
          result: {
            calls: [
              {
                type: 'CREATE',
                to: '0xaddress',
                input: '0xcreationBytecode',
              },
            ],
          },
        },
      ]);

      const result =
        await sourcifyChain.getCreatedAddressesFromBlockTraces(12345);
      expect(result).to.deep.equal({ '0xhash': ['0xaddress'] });
      expect(mockProvider.send).to.have.been.calledWith(
        'debug_traceBlockByNumber',
        ['0x3039', { tracer: 'callTracer' }],
      );
    });

    it('should skip reverted creates in parity block traces', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'create',
          error: 'Reverted',
          result: { address: '0xrevertedAddress' },
          transactionHash: '0xhash1',
          traceAddress: [0],
        },
        {
          // Same traceAddress in another tx must not be seen as the failed frame above
          type: 'create',
          result: { address: '0xaddress' },
          transactionHash: '0xhash2',
          traceAddress: [0],
        },
      ]);

      const result =
        await sourcifyChain.getCreatedAddressesFromBlockTraces(12345);
      expect(result).to.deep.equal({ '0xhash2': ['0xaddress'] });
    });

    it('should throw an error if parity traces are empty', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([]);

      await expect(sourcifyChain.getCreatedAddressesFromBlockTraces(12345)).to
        .be.rejected;
    });

    it('should return an empty array if no create trace is found in parity traces', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'call',
          action: { to: '0xaddress' },
          transactionHash: '0xhash',
        },
      ]);

      const result =
        await sourcifyChain.getCreatedAddressesFromBlockTraces(12345);
      expect(result).to.deep.equal({});
      expect(mockProvider.send).to.have.been.calledWith('trace_block', [
        '0x3039',
      ]);
    });

    it('should throw an error if geth traces are empty', async () => {
      (sourcifyChain as any).rpcs = [
        {
          rpc: 'http://localhost:8545',
          traceSupport: 'debug_traceTransaction',
          provider: new JsonRpcProvider('http://localhost:8545'),
        },
      ];
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([]);

      await expect(sourcifyChain.getCreatedAddressesFromBlockTraces(12345)).to
        .be.rejected;
    });

    it('should return an empty array if no create trace is found in geth traces', async () => {
      (sourcifyChain as any).rpcs = [
        {
          rpc: 'http://localhost:8545',
          traceSupport: 'debug_traceTransaction',
          provider: new JsonRpcProvider('http://localhost:8545'),
        },
      ];
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          txHash: '0xhash',
          result: {
            calls: [
              {
                type: 'CALL',
                to: '0xsomeaddress',
                input: '0xsomeinput',
              },
            ],
          },
        },
      ]);

      const result =
        await sourcifyChain.getCreatedAddressesFromBlockTraces(12345);
      expect(result).to.deep.equal({});
      expect(mockProvider.send).to.have.been.calledWith(
        'debug_traceBlockByNumber',
        ['0x3039', { tracer: 'callTracer' }],
      );
    });
  });

  describe('extractFromParityTraceProvider', () => {
    it('should throw an error if the contract address does not match', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'create',
          result: { address: '0xdifferentAddress' },
          action: { init: '0xcreationBytecode' },
        },
      ]);

      await expect(
        sourcifyChain.extractCreationBytecodeFromParityTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        ),
      ).to.be.rejectedWith(
        `Provided tx 0xhash does not create the expected contract 0xaddress. Created contracts by this tx: 0xdifferentAddress`,
      );
    });

    it('should throw an error when .action.init is not found', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'create',
          result: { address: '0xaddress' },
          action: {}, // Missing 'init' property
        },
      ]);

      await expect(
        sourcifyChain.extractCreationBytecodeFromParityTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        ),
      ).to.be.rejectedWith('.action.init not found');
    });

    it('should skip reverted creates and tolerate a failed create without result', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          // A reverted create for the same would-be address must not match
          type: 'create',
          error: 'Reverted',
          result: { address: '0xaddress' },
          action: { init: '0xrevertedCreationBytecode' },
          traceAddress: [0],
        },
        {
          // Old OpenEthereum shape: failed create without `result`
          type: 'create',
          error: 'Reverted',
          action: { init: '0xnoResultCreationBytecode' },
          traceAddress: [1],
        },
        {
          type: 'create',
          result: { address: '0xaddress' },
          action: { init: '0xcreationBytecode' },
          traceAddress: [2],
        },
      ]);

      const result =
        await sourcifyChain.extractCreationBytecodeFromParityTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        );
      expect(result).to.equal('0xcreationBytecode');
    });

    it('should skip a create under a reverted parent frame', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'call',
          error: 'Reverted',
          action: {},
          traceAddress: [0],
        },
        {
          // No own `error`, but discarded by the parent's revert
          type: 'create',
          result: { address: '0xaddress' },
          action: { init: '0xcreationBytecode' },
          traceAddress: [0, 0],
        },
      ]);

      await expect(
        sourcifyChain.extractCreationBytecodeFromParityTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        ),
      ).to.be.rejectedWith(
        DefinitiveError,
        'Provided tx 0xhash does not create the expected contract 0xaddress',
      );
    });
  });

  describe('extractFromGethTraceProvider', () => {
    it('should extract creation bytecode from geth traces', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({
        type: 'CALL',
        to: '0xfactoryAddress',
        calls: [
          {
            type: 'CREATE',
            to: '0xaddress',
            input: '0xcreationBytecode',
          },
        ],
      });

      const result =
        await sourcifyChain.extractCreationBytecodeFromGethTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        );
      expect(result).to.equal('0xcreationBytecode');
    });

    it('should handle nested CREATE calls in geth traces', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({
        type: 'CALL',
        to: '0xrouterAddress',
        calls: [
          {
            type: 'CALL',
            calls: [
              {
                type: 'CREATE',
                to: '0xaddress',
                input: '0xcreationBytecode',
              },
            ],
          },
        ],
      });

      const result =
        await sourcifyChain.extractCreationBytecodeFromGethTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        );
      expect(result).to.equal('0xcreationBytecode');
    });

    it('should find the root CREATE frame of a direct deployment', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({
        type: 'CREATE',
        to: '0xaddress',
        input: '0xcreationBytecode',
      });

      const result =
        await sourcifyChain.extractCreationBytecodeFromGethTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        );
      expect(result).to.equal('0xcreationBytecode');
    });

    it('should give a definitive error when a direct deployment creates a different contract', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({
        type: 'CREATE',
        to: '0xdifferentaddress',
        input: '0xcreationBytecode',
      });

      await expect(
        sourcifyChain.extractCreationBytecodeFromGethTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        ),
      ).to.be.rejectedWith(
        DefinitiveError,
        'No CREATE or CREATE2 call found for the address 0xaddress',
      );
    });

    it('should skip reverted CREATE frames, frames under a reverted parent, and frames without a `to`', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({
        type: 'CREATE',
        to: '0xtokenAddress',
        input: '0xtokenCreationBytecode',
        calls: [
          {
            type: 'CREATE2',
            to: '0x0000000000000000000000000000000000000000',
            input: '0xrevertedCreationBytecode',
            error: 'execution reverted',
          },
          {
            type: 'CALL',
            error: 'execution reverted',
            calls: [
              {
                type: 'CREATE',
                to: '0xaddress',
                input: '0xdiscardedCreationBytecode',
              },
            ],
          },
          {
            // A frame without a `to` must not crash the lookup
            type: 'CREATE',
            input: '0xnoToCreationBytecode',
          },
          {
            type: 'CREATE',
            to: '0xaddress',
            input: '0xcreationBytecode',
          },
        ],
      });

      const result =
        await sourcifyChain.extractCreationBytecodeFromGethTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        );
      expect(result).to.equal('0xcreationBytecode');
    });

    it('should throw an error if traces response is empty or malformed', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({});

      await expect(
        sourcifyChain.extractCreationBytecodeFromGethTraceProvider(
          sourcifyChain.rpcs[0],
          '0xhash',
          '0xaddress',
        ),
      ).to.be.rejectedWith('received empty or malformed response');
    });
  });

  describe('Circuit Breaker Pattern', () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      clock = sandbox.useFakeTimers();
    });

    it('should skip blocked RPCs and not call them', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpcs: [
          {
            rpc: 'http://localhost:8545',
          },
          {
            rpc: 'http://localhost:8546',
          },
        ],
        supported: true,
      });
      const mockProvider1 = sourcifyChain.rpcs[0].provider!;
      const mockProvider2 = sourcifyChain.rpcs[1].provider!;
      const getBlockNumberStub1 = sandbox
        .stub(mockProvider1, 'getBlockNumber')
        .rejects(new RpcFailure('RPC 1 failed'));
      const getBlockNumberStub2 = sandbox
        .stub(mockProvider2, 'getBlockNumber')
        .resolves(100);

      // First call - both RPCs should be tried
      await sourcifyChain.getBlockNumber();
      expect(getBlockNumberStub1).to.have.been.calledOnce;
      expect(getBlockNumberStub2).to.have.been.calledOnce;
      // Second call - both RPCs should be tried because one retry is allowed
      await sourcifyChain.getBlockNumber();
      expect(getBlockNumberStub1).to.have.been.calledTwice;
      expect(getBlockNumberStub2).to.have.been.calledTwice;
      // Third call - first RPC should be skipped
      await sourcifyChain.getBlockNumber();
      expect(getBlockNumberStub1).to.have.been.calledTwice;
      expect(getBlockNumberStub2).to.have.been.calledThrice;
    });

    it('should record RPC health correctly after failures', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpcs: [
          {
            rpc: 'http://localhost:8545',
          },
        ],
        supported: true,
      });
      expect(sourcifyChain.rpcs[0].health).to.be.undefined;

      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox
        .stub(mockProvider, 'getBlockNumber')
        .rejects(new RpcFailure('RPC failed'));
      try {
        await sourcifyChain.getBlockNumber();
      } catch (e) {
        // Expected to fail
      }

      expect(sourcifyChain.rpcs[0].health?.consecutiveFailures).to.equal(1);
      expect(sourcifyChain.rpcs[0].health?.nextRetryTime).to.be.a('number');
    });

    it('should use exponential backoff for consecutive failures', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpcs: [
          {
            rpc: 'http://localhost:8545',
          },
          {
            rpc: 'http://localhost:8546',
          },
        ],
        supported: true,
      });

      const mockProvider1 = sourcifyChain.rpcs[0].provider!;
      const mockProvider2 = sourcifyChain.rpcs[1].provider!;
      sandbox
        .stub(mockProvider1, 'getBlockNumber')
        .rejects(new RpcFailure('RPC 1 failed'));
      sandbox.stub(mockProvider2, 'getBlockNumber').resolves(100);

      const startTime = Date.now();
      // One retry is always allowed
      await sourcifyChain.getBlockNumber();
      await sourcifyChain.getBlockNumber();
      const retryTime = sourcifyChain.rpcs[0].health!.nextRetryTime!;
      expect(retryTime - startTime).to.equal(10_000);
    });

    it('should reset health after successful RPC call', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpcs: [
          {
            rpc: 'http://localhost:8545',
          },
        ],
        supported: true,
      });

      const mockProvider = sourcifyChain.rpcs[0].provider!;
      const getBlockNumberStub = sandbox.stub(mockProvider, 'getBlockNumber');
      getBlockNumberStub.onFirstCall().rejects(new RpcFailure('RPC failed'));
      try {
        await sourcifyChain.getBlockNumber();
      } catch (e) {
        // Expected to fail
      }

      expect(sourcifyChain.rpcs[0].health?.consecutiveFailures).to.equal(1);

      getBlockNumberStub.onSecondCall().resolves(100);
      await sourcifyChain.getBlockNumber();

      expect(sourcifyChain.rpcs[0].health?.consecutiveFailures).to.equal(0);
      expect(sourcifyChain.rpcs[0].health?.nextRetryTime).to.be.undefined;
    });

    it('should retry blocked RPC after backoff period expires', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpcs: [
          {
            rpc: 'http://localhost:8545',
          },
        ],
        supported: true,
      });

      const mockProvider = sourcifyChain.rpcs[0].provider!;
      const getBlockNumberStub = sandbox.stub(mockProvider, 'getBlockNumber');
      getBlockNumberStub.rejects(new RpcFailure('RPC failed'));
      try {
        await sourcifyChain.getBlockNumber();
      } catch (e) {
        // Expected to fail
      }
      expect(sourcifyChain.rpcs[0].health?.consecutiveFailures).to.equal(1);

      // One retry is always allowed
      try {
        await sourcifyChain.getBlockNumber();
      } catch (e) {
        // Expected to fail
      }
      expect(sourcifyChain.rpcs[0].health?.consecutiveFailures).to.equal(2);

      // Call should now fail without calling provider
      const callCountBefore = getBlockNumberStub.callCount;
      try {
        await sourcifyChain.getBlockNumber();
      } catch (e) {
        // Expected to fail
      }
      expect(getBlockNumberStub.callCount).to.equal(callCountBefore);

      clock.tick(10_001);

      // Now it should retry
      getBlockNumberStub.resolves(100);
      await sourcifyChain.getBlockNumber();
      expect(getBlockNumberStub.callCount).to.equal(callCountBefore + 1);
    });
  });
});

describe('SourcifyChain unit tests', () => {
  let hardhatNodeProcess: ChildProcess;
  let sourcifyChain: SourcifyChain;
  before(async () => {
    hardhatNodeProcess = await startHardhatNetwork(8546);
    sourcifyChain = new SourcifyChain({
      name: 'TestChain',
      chainId: 1,
      rpcs: [
        {
          rpc: 'http://localhost:8546',
          traceSupport: 'trace_transaction',
        },
      ],
      supported: true,
    });
  });
  after(async () => {
    await stopHardhatNetwork(hardhatNodeProcess);
  });
  it("Should fail to instantiate with empty rpc's", function () {
    const emptyRpc = { ...sourcifyChain, rpcs: [] };
    try {
      new SourcifyChain(emptyRpc);
      throw new Error('Should have failed');
    } catch (err) {
      if (err instanceof Error) {
        expect(err.message).to.equal(
          'No RPC provider was given for this chain with id ' +
            emptyRpc.chainId +
            ' and name ' +
            emptyRpc.name,
        );
      } else {
        throw err;
      }
    }
  });
  it('Should getBlock', async function () {
    const block = await sourcifyChain.getBlock(0);
    expect(block?.number).equals(0);
  });
  it('Should getBlockNumber', async function () {
    const blockNumber = await sourcifyChain.getBlockNumber();
    expect(blockNumber > 0);
  });
  it('Should fail to get non-existing transaction', async function () {
    try {
      await sourcifyChain.getTx(
        '0x79ab5d59fcb70ca3f290aa39ed3f156a5c4b3897176aebd455cd20b6a30b107a',
      );
      throw new Error('Should have failed');
    } catch (err) {
      if (err instanceof Error) {
        expect(err.message).to.equal(
          `All RPCs failed or are blocked for getTx(0x79ab5d59fcb70ca3f290aa39ed3f156a5c4b3897176aebd455cd20b6a30b107a) on chain ${sourcifyChain.chainId}`,
        );
      } else {
        throw err;
      }
    }
  });
});
