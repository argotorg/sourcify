import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chai from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { SourcifyChain, TraceSupportedRPC } from '../src';
import { JsonRpcProvider } from 'ethers';
import {
  startHardhatNetwork,
  stopHardhatNetwork,
} from './hardhat-network-helper';
import { ChildProcess } from 'child_process';

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
      rpc: ['http://localhost:8545'],
      supported: true,
      traceSupportedRPCs: [{ index: 0, type: 'trace_transaction' }],
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getCreationBytecodeForFactory', () => {
    it('should throw an error if trace support is not available', async () => {
      sourcifyChain = new SourcifyChain({
        name: 'TestChain',
        chainId: 1,
        rpc: ['http://localhost:8545'],
        supported: true,
      });
      await expect(
        sourcifyChain.getCreationBytecodeForFactory('0xhash', '0xaddress'),
      ).to.be.rejectedWith(
        'No trace support for chain 1. No other method to get the creation bytecode',
      );
    });

    it('should extract creation bytecode from parity traces', async () => {
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
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

    it('should throw an error if no create trace is found', async () => {
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
      sandbox
        .stub(mockProvider, 'send')
        .resolves([{ type: 'call' }, { type: 'suicide' }]);

      await expect(
        sourcifyChain.getCreationBytecodeForFactory('0xhash', '0xaddress'),
      ).to.be.rejectedWith('Couldnt get the creation bytecode for factory');
    });

    it('should try multiple trace-supported RPCs if the first one fails', async () => {
      (sourcifyChain as any).traceSupportedRPCs = [
        { index: 0, type: 'trace_transaction' },
        { index: 1, type: 'trace_transaction' },
      ] as TraceSupportedRPC[];
      sourcifyChain.providers.push(
        new JsonRpcProvider('http://localhost:8546'),
      );

      const mockProvider1 = sourcifyChain.providers[0] as JsonRpcProvider;
      const mockProvider2 = sourcifyChain.providers[1] as JsonRpcProvider;

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
      (sourcifyChain as any).traceSupportedRPCs = [
        { index: 0, type: 'debug_traceTransaction' },
      ] as TraceSupportedRPC[];
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
      sandbox.stub(mockProvider, 'send').resolves({
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
      (sourcifyChain as any).traceSupportedRPCs = [
        { index: 0, type: 'debug_traceTransaction' },
      ] as TraceSupportedRPC[];
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
      sandbox.stub(mockProvider, 'send').resolves({
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
      ).to.be.rejectedWith(
        'Couldnt get the creation bytecode for factory 0xaddress with tx 0xhash on chain 1',
      );
    });

    it('should throw an error if the contract address is not found in geth traces', async () => {
      (sourcifyChain as any).traceSupportedRPCs = [
        { index: 0, type: 'debug_traceTransaction' },
      ] as TraceSupportedRPC[];
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
      sandbox.stub(mockProvider, 'send').resolves({
        calls: [
          {
            type: 'CREATE',
            to: '0xdifferentaddress',
            input: '0xcreationBytecode',
          },
        ],
      });

      await expect(
        sourcifyChain.getCreationBytecodeForFactory('0xhash', '0xaddress'),
      ).to.be.rejectedWith(
        'Couldnt get the creation bytecode for factory 0xaddress with tx 0xhash on chain 1',
      );
    });
  });

  describe('extractFromParityTraceProvider', () => {
    it('should throw an error if the contract address does not match', async () => {
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'create',
          result: { address: '0xdifferentAddress' },
          action: { init: '0xcreationBytecode' },
        },
      ]);

      await expect(
        sourcifyChain.extractFromParityTraceProvider(
          '0xhash',
          '0xaddress',
          mockProvider,
        ),
      ).to.be.rejectedWith(
        `Provided tx 0xhash does not create the expected contract 0xaddress. Created contracts by this tx: 0xdifferentAddress`,
      );
    });

    it('should throw an error when .action.init is not found', async () => {
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
      sandbox.stub(mockProvider, 'send').resolves([
        {
          type: 'create',
          result: { address: '0xaddress' },
          action: {}, // Missing 'init' property
        },
      ]);

      await expect(
        sourcifyChain.extractFromParityTraceProvider(
          '0xhash',
          '0xaddress',
          mockProvider,
        ),
      ).to.be.rejectedWith('.action.init not found');
    });

    // Add more tests for extractFromParityTraceProvider here if needed
  });

  describe('extractFromGethTraceProvider', () => {
    it('should extract creation bytecode from geth traces', async () => {
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
      sandbox.stub(mockProvider, 'send').resolves({
        calls: [
          {
            type: 'CREATE',
            to: '0xaddress',
            input: '0xcreationBytecode',
          },
        ],
      });

      const result = await sourcifyChain.extractFromGethTraceProvider(
        '0xhash',
        '0xaddress',
        mockProvider,
      );
      expect(result).to.equal('0xcreationBytecode');
    });

    it('should handle nested CREATE calls in geth traces', async () => {
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
      sandbox.stub(mockProvider, 'send').resolves({
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

      const result = await sourcifyChain.extractFromGethTraceProvider(
        '0xhash',
        '0xaddress',
        mockProvider,
      );
      expect(result).to.equal('0xcreationBytecode');
    });

    it('should throw an error if traces response is empty or malformed', async () => {
      const mockProvider = sourcifyChain.providers[0] as JsonRpcProvider;
      sandbox.stub(mockProvider, 'send').resolves({});

      await expect(
        sourcifyChain.extractFromGethTraceProvider(
          '0xhash',
          '0xaddress',
          mockProvider,
        ),
      ).to.be.rejectedWith('received empty or malformed response');
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
      rpc: ['http://localhost:8546'],
      supported: true,
      traceSupportedRPCs: [{ index: 0, type: 'trace_transaction' }],
    });
  });
  after(async () => {
    await stopHardhatNetwork(hardhatNodeProcess);
  });
  it("Should fail to instantiate with empty rpc's", function () {
    const emptyRpc = { ...sourcifyChain, rpc: [] };
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
          `None of the RPCs responded fetching tx 0x79ab5d59fcb70ca3f290aa39ed3f156a5c4b3897176aebd455cd20b6a30b107a on chain ${sourcifyChain.chainId}`,
        );
      } else {
        throw err;
      }
    }
  });
});
