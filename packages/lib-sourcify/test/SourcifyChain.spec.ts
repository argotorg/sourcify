import { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chai from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { SourcifyChain } from '../src';
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
        'No trace support for chain 1. No other method to get the creation bytecode',
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

    it('should throw an error if no create trace is found', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox
        .stub(mockProvider, 'send')
        .resolves([{ type: 'call' }, { type: 'suicide' }]);

      await expect(
        sourcifyChain.getCreationBytecodeForFactory('0xhash', '0xaddress'),
      ).to.be.rejected;
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
      ).to.be.rejected;
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
        sourcifyChain.extractFromParityTraceProvider(
          '0xhash',
          '0xaddress',
          sourcifyChain.rpcs[0],
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
        sourcifyChain.extractFromParityTraceProvider(
          '0xhash',
          '0xaddress',
          sourcifyChain.rpcs[0],
        ),
      ).to.be.rejectedWith('.action.init not found');
    });

    // Add more tests for extractFromParityTraceProvider here if needed
  });

  describe('extractFromGethTraceProvider', () => {
    it('should extract creation bytecode from geth traces', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
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
        sourcifyChain.rpcs[0],
      );
      expect(result).to.equal('0xcreationBytecode');
    });

    it('should handle nested CREATE calls in geth traces', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
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
        sourcifyChain.rpcs[0],
      );
      expect(result).to.equal('0xcreationBytecode');
    });

    it('should throw an error if traces response is empty or malformed', async () => {
      const mockProvider = sourcifyChain.rpcs[0].provider!;
      sandbox.stub(mockProvider, 'send').resolves({});

      await expect(
        sourcifyChain.extractFromGethTraceProvider(
          '0xhash',
          '0xaddress',
          sourcifyChain.rpcs[0],
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
        .rejects(new Error('RPC 1 failed'));
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
        .rejects(new Error('RPC failed'));
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
        .rejects(new Error('RPC 1 failed'));
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
      getBlockNumberStub.onFirstCall().rejects(new Error('RPC failed'));
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
      getBlockNumberStub.rejects(new Error('RPC failed'));
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
