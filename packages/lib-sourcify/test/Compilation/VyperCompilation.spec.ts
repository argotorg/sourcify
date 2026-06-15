import { describe, it } from 'mocha';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import path from 'path';
import fs from 'fs';
import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import type { ImmutableReferences } from '@ethereum-sourcify/compilers-types';
import {
  returnImmutableReferences,
  VyperCompilation,
} from '../../src/Compilation/VyperCompilation';
import { PreRunCompilation } from '../../src/Compilation/PreRunCompilation';
import { returnLegacyVyperImmutableReferences } from '../../src/Compilation/legacyVyperImmutablesHelpers';
import { vyperCompiler } from '../utils';

chai.use(chaiAsPromised);

describe('VyperCompilation', () => {
  it('should compile a simple Vyper contract', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractFileName = 'test.vy';
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    const compilation = new VyperCompilation(
      vyperCompiler,
      '0.3.10+commit.91361694',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    await compilation.compile();
    expect(compilation.creationBytecode).to.equal(
      '0x61008f61000f60003961008f6000f360003560e01c63c605f76c8118610084573461008a57602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181518152602082015160208201528051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b60006000fd5b600080fd84188f8000a16576797065728300030a0012',
    );
    expect(compilation.runtimeBytecode).to.equal(
      '0x60003560e01c63c605f76c8118610084573461008a57602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181518152602082015160208201528051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b60006000fd5b600080fd',
    );
  });

  it('should handle immutable references correctly', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'withImmutables',
    );
    const contractFileName = 'test.vy';
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    const compilation = new VyperCompilation(
      vyperCompiler,
      '0.4.0+commit.e9db8d9f',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'london',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    await compilation.compile();
    expect(compilation.immutableReferences).to.deep.equal({
      '0': [{ length: 96, start: 167 }],
    });
  });

  it('should produce different bytecode with storage_layout_overrides', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'withStorageLayout',
    );
    const contractFileName = 'test.vy';
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    // Compile without storage_layout_overrides
    const compilationWithout = new VyperCompilation(
      vyperCompiler,
      '0.4.1+commit.8a93dd27',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'cancun',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );
    await compilationWithout.compile();

    // Compile with storage_layout_overrides (swap slots of a and b)
    const compilationWith = new VyperCompilation(
      vyperCompiler,
      '0.4.1+commit.8a93dd27',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'cancun',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
        storage_layout_overrides: {
          [contractFileName]: {
            a: { type: 'uint256', slot: 1, n_slots: 1 },
            b: { type: 'uint256', slot: 0, n_slots: 1 },
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );
    await compilationWith.compile();

    expect(compilationWith.creationBytecode).to.not.equal(
      compilationWithout.creationBytecode,
    );
    expect(compilationWith.runtimeBytecode).to.not.equal(
      compilationWithout.runtimeBytecode,
    );
  });

  it('should generate correct CBOR auxdata positions', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractFileName = 'test.vy';
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    const compilation = new VyperCompilation(
      vyperCompiler,
      '0.3.10+commit.91361694',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();

    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({
      '1': { offset: 158, value: '0x84188f8000a16576797065728300030a0012' },
    });
  });

  it('should throw compilation errors', async () => {
    const invalidContent = 'invalid vyper code @123';
    const contractFileName = 'invalid.vy';

    const compilation = new VyperCompilation(
      vyperCompiler,
      '0.3.10+commit.91361694',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: invalidContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    try {
      await compilation.compile();
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).to.exist;
    }
  });

  it('should handle missing bytecode in compilation output', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractName = 'test';
    const contractFileName = `${contractName}.vy`;
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    // Mock vyperCompiler to return output without bytecode
    const mockCompiler = {
      compile: async () => ({
        contracts: {
          ['different' + contractFileName]: {
            ['different' + contractName]: {
              evm: {
                bytecode: {
                  object: '',
                },
              },
            },
          },
        },
      }),
    };

    const compilation = new VyperCompilation(
      mockCompiler as any,
      '0.3.10+commit.91361694',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractName,
        path: contractFileName,
      },
    );

    try {
      await compilation.compile();
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).to.equal('Contract not found in compiler output.');
    }
  });

  it('should handle errors in CBOR auxdata positions generation', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractName = 'test';
    const contractFileName = `${contractName}.vy`;
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    // Mock vyperCompiler to return output without auxdata
    const mockCompiler = {
      compile: async () => ({
        contracts: {
          [contractFileName]: {
            [contractName]: {
              evm: {
                bytecode: {
                  object: '0x123456',
                },
              },
            },
          },
        },
      }),
    };

    const compilation = new VyperCompilation(
      mockCompiler as any,
      '0.3.10+commit.91361694',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractName,
        path: contractFileName,
      },
    );

    await compilation.compile();
    await expect(compilation.generateCborAuxdataPositions())
      .to.eventually.be.rejectedWith()
      .and.have.property('code', 'cannot_generate_cbor_auxdata_positions');
  });

  it('should handle beta versions of Vyper, transforming the version to a valid semver', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractName = 'test';
    const contractFileName = `${contractName}.vy`;
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    // We don't actually need to compile here, we just need to test the version transformation
    const mockCompiler = {
      compile: async () => ({
        contracts: {
          [contractFileName]: {
            [contractName]: {
              evm: {
                bytecode: {
                  object: '0x123456',
                },
              },
            },
          },
        },
      }),
    };

    const compilation = new VyperCompilation(
      mockCompiler as any,
      '0.4.1b4+commit.4507d2a6',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'london',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractName,
        path: contractFileName,
      },
    );

    await compilation.compile();
    expect(compilation.compilerVersionCompatibleWithSemver).to.equal(
      '0.4.1+commit.4507d2a6',
    );
  });

  it('should throw error for invalid Vyper version format', () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractFileName = 'test.vy';
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    expect(
      () =>
        new VyperCompilation(
          vyperCompiler,
          'invalid.version.format', // Invalid version format
          {
            language: 'Vyper',
            sources: {
              [contractFileName]: {
                content: contractContent,
              },
            },
            settings: {
              evmVersion: 'istanbul',
              outputSelection: {
                '*': ['evm.bytecode'],
              },
            },
          },
          {
            name: contractFileName.split('.')[0],
            path: contractFileName,
          },
        ),
    ).to.throw('Invalid compiler version');
  });

  it('should handle bytecode decoding errors in getImmutableReferences', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractName = 'test';
    const contractFileName = `${contractName}.vy`;
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    // Mock compiler to return invalid bytecode that will cause decode to fail
    const mockCompiler = {
      compile: async () => ({
        contracts: {
          [contractFileName]: {
            [contractName]: {
              evm: {
                bytecode: {
                  object: '0x1234', // Invalid/malformed bytecode
                },
                deployedBytecode: {
                  object: '0x5678',
                },
              },
            },
          },
        },
      }),
    };

    const compilation = new VyperCompilation(
      mockCompiler as any,
      '0.3.10+commit.91361694', // Using version >= 0.3.10 to trigger immutable reference check
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractName,
        path: contractFileName,
      },
    );

    await compilation.compile();
    const immutableRefs = compilation.immutableReferences;
    expect(immutableRefs).to.be.empty;
  });

  it('should handle vyper versions lower than 0.3.5', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractFileName = 'test.vy';
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    const compilation = new VyperCompilation(
      vyperCompiler,
      '0.3.4+commit.f31f0ec4',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();
    expect(compilation.creationBytecode).to.equal(
      '0x6100b761000f6000396100b76000f36003361161000c576100a1565b60003560e01c346100a75763c605f76c811861009f57600436186100a757602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181518082526020830160208301815181525050508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b505b60006000fd5b600080fda165767970657283000304',
    );
    expect(compilation.runtimeBytecode).to.equal(
      '0x6003361161000c576100a1565b60003560e01c346100a75763c605f76c811861009f57600436186100a757602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181518082526020830160208301815181525050508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b505b60006000fd5b600080fda165767970657283000304',
    );
    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({
      '1': { offset: 187, value: '0xa165767970657283000304' },
    });
    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': { offset: 172, value: '0xa165767970657283000304' },
    });
  });

  it('should handle vyper versions lower than 0.3.10', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractFileName = 'test.vy';
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    // Test with version < 0.3.10
    const compilation = new VyperCompilation(
      vyperCompiler,
      '0.3.7+commit.6020b8bb',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();
    expect(compilation.creationBytecode).to.equal(
      '0x6100b961000f6000396100b96000f36003361161000c576100a1565b60003560e01c346100a75763c605f76c811861009f57600436106100a757602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181518082526020830160208301815181525050508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b505b60006000fd5b600080fda165767970657283000307000b',
    );
    expect(compilation.runtimeBytecode).to.equal(
      '0x6003361161000c576100a1565b60003560e01c346100a75763c605f76c811861009f57600436106100a757602080608052600c6040527f48656c6c6f20576f726c6421000000000000000000000000000000000000000060605260408160800181518082526020830160208301815181525050508051806020830101601f82600003163682375050601f19601f8251602001011690509050810190506080f35b505b60006000fd5b600080fda165767970657283000307000b',
    );
    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({
      '1': { offset: 187, value: '0xa165767970657283000307000b' },
    });
    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': { offset: 172, value: '0xa165767970657283000307000b' },
    });
  });

  it('should clean compiler version with v prefix', () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractFileName = 'test.vy';
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    const compilation = new VyperCompilation(
      vyperCompiler,
      'v0.3.10+commit.91361694',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    expect(compilation.compilerVersion).to.equal('0.3.10+commit.91361694');
  });
});

// Helper to build a VyperCompilation with a mock compiler (no actual compilation needed)
function makeCompilation(version: string) {
  const mockCompiler = {
    compile: async () => ({ contracts: {} as any }),
  };
  return new VyperCompilation(
    mockCompiler as any,
    version,
    {
      language: 'Vyper',
      sources: { 'test.vy': { content: '' } },
      settings: { outputSelection: { '*': [] } },
    },
    { name: 'test', path: 'test.vy' },
  );
}

function outputsFor(version: string): string[] {
  const compilation = makeCompilation(version);
  return compilation.jsonInput.settings!.outputSelection![
    'test.vy'
  ] as string[];
}

describe('VyperCompilation outputSelection version gating', () => {
  it('0.1.x: excludes userdoc, devdoc, layout, evm.bytecode.sourceMap', () => {
    const outputs = outputsFor('0.1.0b16+commit.5e4a94a');
    expect(outputs).to.not.include('userdoc');
    expect(outputs).to.not.include('devdoc');
    expect(outputs).to.not.include('layout');
    expect(outputs).to.not.include('evm.bytecode.sourceMap');
  });

  it('0.2.x: includes userdoc and devdoc, excludes layout, evm.bytecode.sourceMap', () => {
    const outputs = outputsFor('0.2.0+commit.a7f14fe');
    expect(outputs).to.include('userdoc');
    expect(outputs).to.include('devdoc');
    expect(outputs).to.not.include('layout');
    expect(outputs).to.not.include('evm.bytecode.sourceMap');
  });

  it('0.4.0rc3: excludes layout and evm.bytecode.sourceMap', () => {
    const outputs = outputsFor('0.4.0rc3+commit.f2136550');
    expect(outputs).to.include('userdoc');
    expect(outputs).to.include('devdoc');
    expect(outputs).to.not.include('layout');
    expect(outputs).to.not.include('evm.bytecode.sourceMap');
  });

  it('0.4.0rc4: includes evm.bytecode.sourceMap, excludes layout', () => {
    const outputs = outputsFor('0.4.0rc4+commit.d0d581d');
    expect(outputs).to.include('userdoc');
    expect(outputs).to.include('devdoc');
    expect(outputs).to.not.include('layout');
    expect(outputs).to.include('evm.bytecode.sourceMap');
  });

  it('0.4.0 stable: includes evm.bytecode.sourceMap, excludes layout', () => {
    const outputs = outputsFor('0.4.0+commit.e9db8d9f');
    expect(outputs).to.include('userdoc');
    expect(outputs).to.include('devdoc');
    expect(outputs).to.not.include('layout');
    expect(outputs).to.include('evm.bytecode.sourceMap');
  });

  it('0.4.1+: includes userdoc, devdoc, layout, evm.bytecode.sourceMap', () => {
    const outputs = outputsFor('0.4.1+commit.8a93dd27');
    expect(outputs).to.include('userdoc');
    expect(outputs).to.include('devdoc');
    expect(outputs).to.include('layout');
    expect(outputs).to.include('evm.bytecode.sourceMap');
  });
});

describe('returnLegacyVyperImmutableReferences', () => {
  async function compileLegacyImmutable(
    compilerVersion: string,
    sourceVersion: string,
  ): Promise<VyperCompilation> {
    const contractFileName = 'test.vy';
    const contractContent = `# @version ${sourceVersion}

TARGET: immutable(address)


@external
def __init__(_target: address):
    TARGET = _target


@external
@view
def target() -> address:
    return TARGET
`;
    const compilation = new VyperCompilation(
      vyperCompiler,
      compilerVersion,
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    await compilation.compile();
    return compilation;
  }

  function expectSingleTailReference(
    compilation: VyperCompilation,
    length: number,
  ) {
    expect(compilation.immutableReferences).to.deep.equal({
      '0': [
        {
          length,
          start: compilation.runtimeBytecode.length / 2 - 1,
        },
      ],
    });
  }

  it('derives a synthetic tail reference from real Vyper 0.3.1 text IR', async () => {
    const compilation = await compileLegacyImmutable('0.3.1', '0.3.1');

    expectSingleTailReference(compilation, 32);
    expect(typeof (compilation.contractCompilerOutput as any).ir).to.equal(
      'string',
    );
  });

  it('derives a synthetic tail reference from real Vyper 0.3.2 structured IR', async () => {
    const compilation = await compileLegacyImmutable(
      '0.3.2+commit.3b6a4117',
      '0.3.2',
    );

    expectSingleTailReference(compilation, 32);
    expect(typeof (compilation.contractCompilerOutput as any).ir).to.equal(
      'object',
    );
  });

  it('derives a synthetic tail reference from real Vyper 0.3.7 structured IR', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'legacyImmutables_0_3_7',
    );
    const contractFileName = 'test.vy';
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );
    const compilation = new VyperCompilation(
      vyperCompiler,
      '0.3.7+commit.6020b8bb',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    await compilation.compile();

    expect(compilation.immutableReferences).to.deep.equal({
      '0': [{ length: 32, start: 88 }],
    });
  });

  it('uses compiler-resolved structured IR size for Vyper 0.3.7 constant-bound immutables', async () => {
    const contractFileName = 'test.vy';
    const contractContent = `# @version 0.3.7

N_COINS: constant(int128) = 2
N_STABLECOINS: constant(int128) = 3
N_UL_COINS: constant(int128) = N_COINS + N_STABLECOINS - 1
TARGET: public(immutable(address))
SALT: immutable(bytes32)
COINS: immutable(address[N_COINS])
UNDERLYING_COINS: immutable(address[N_UL_COINS])


@external
def __init__(
    _target: address,
    _salt: bytes32,
    _coins: address[N_COINS],
    _underlying_coins: address[N_UL_COINS]
):
    TARGET = _target
    SALT = _salt
    COINS = _coins
    UNDERLYING_COINS = _underlying_coins


@external
@view
def salt() -> bytes32:
    return SALT
`;
    const compilation = new VyperCompilation(
      vyperCompiler,
      '0.3.7+commit.6020b8bb',
      {
        language: 'Vyper',
        sources: {
          [contractFileName]: {
            content: contractContent,
          },
        },
        settings: {
          evmVersion: 'istanbul',
          outputSelection: {
            '*': ['evm.bytecode'],
          },
        },
      },
      {
        name: contractFileName.split('.')[0],
        path: contractFileName,
      },
    );

    await compilation.compile();

    expect(compilation.immutableReferences).to.deep.equal({
      '0': [{ length: 256, start: compilation.runtimeBytecode.length / 2 - 1 }],
    });
  });

  it('derives a synthetic tail reference from Vyper 0.3.1 text IR', () => {
    const compilerOutput = {
      contracts: {
        'test.vy': {
          test: {
            ir: `
              [seq,
                [mstore, [add, 320, _lllsz], [mload, 256]],
                [mstore, [add, 352, _lllsz], [mload, 288]],
                [return, 320, [add, 64, _lllsz]]]
              ]
            `,
          },
        },
      },
    };

    expect(
      returnImmutableReferences(
        '0.3.1',
        '0x',
        '0x600102',
        AuxdataStyle.VYPER_LT_0_3_4,
        compilerOutput as any,
        { name: 'test', path: 'test.vy' },
      ),
    ).to.deep.equal({
      '0': [{ length: 64, start: 3 }],
    });
  });

  it('does not derive a legacy immutable reference before Vyper 0.3.1', () => {
    const compilerOutput = {
      contracts: {
        'test.vy': {
          test: {
            ir: '[return, 320, [add, 64, _lllsz]]',
          },
        },
      },
    };

    expect(
      returnImmutableReferences(
        '0.3.0',
        '0x',
        '0x600102',
        AuxdataStyle.VYPER_LT_0_3_4,
        compilerOutput as any,
        { name: 'test', path: 'test.vy' },
      ),
    ).to.deep.equal({});
  });

  it('ignores ambiguous Vyper 0.3.1 text IR immutable lengths', () => {
    const compilerOutput = {
      contracts: {
        'test.vy': {
          test: {
            ir: `
              [return, 256, [add, 32, _lllsz]]
              [return, 320, [add, 64, _lllsz]]
            `,
          },
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        { name: 'test', path: 'test.vy' },
        '0x6000',
      ),
    ).to.deep.equal({});
  });

  it('ignores invalid structured IR immutable lengths', () => {
    const compilerOutput = {
      contracts: {
        'test.vy': {
          test: {
            ir: {
              deploy: [256, { runtime: [] }, 31],
            },
          },
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        { name: 'test', path: 'test.vy' },
        '0x6000',
      ),
    ).to.deep.equal({});
  });

  it('ignores ambiguous structured IR immutable lengths', () => {
    const compilerOutput = {
      contracts: {
        'test.vy': {
          test: {
            ir: {
              seq: [
                { deploy: [256, { runtime: [] }, 32] },
                { deploy: [320, { runtime: [] }, 64] },
              ],
            },
          },
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        { name: 'test', path: 'test.vy' },
        '0x6000',
      ),
    ).to.deep.equal({});
  });

  it('ignores zero structured IR immutable length', () => {
    const compilerOutput = {
      contracts: {
        'test.vy': {
          test: {
            ir: {
              deploy: [256, { runtime: [] }, 0],
            },
          },
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        { name: 'test', path: 'test.vy' },
        '0x6000',
      ),
    ).to.deep.equal({});
  });

  it('only checks the compilation target contract IR', () => {
    const compilerOutput = {
      contracts: {
        'target.vy': {
          target: {
            ir: { seq: [] },
          },
          unused: {
            ir: {
              deploy: [256, { runtime: [] }, 32],
            },
          },
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        { name: 'target', path: 'target.vy' },
        '0x6000',
      ),
    ).to.deep.equal({});
    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        { name: 'unused', path: 'target.vy' },
        '0x6000',
      ),
    ).to.deep.equal({
      '0': [{ length: 32, start: 2 }],
    });
  });

  function createPreRunVyperCompilation(
    immutableReferences?: ImmutableReferences,
  ) {
    return new PreRunCompilation(
      vyperCompiler,
      '0.3.7+commit.6020b8bb',
      {
        language: 'Vyper',
        sources: {
          'test.vy': {
            content: '',
          },
        },
        settings: {
          outputSelection: {
            '*': [],
          },
        },
      },
      {
        compiler: '0.3.7+commit.6020b8bb',
        contracts: {
          'test.vy': {
            test: {
              abi: [],
              userdoc: {
                kind: 'user',
                methods: {},
              },
              devdoc: {
                kind: 'dev',
                methods: {},
              },
              evm: {
                bytecode: {
                  object: '600102',
                  opcodes: '',
                },
                deployedBytecode: {
                  object: '600102',
                  opcodes: '',
                  sourceMap: '',
                  ...(immutableReferences !== undefined
                    ? { immutableReferences }
                    : {}),
                },
                methodIdentifiers: {},
              },
            },
          },
        },
        sources: {
          'test.vy': {
            id: 0,
            ast: {},
          },
        },
      } as any,
      { name: 'test', path: 'test.vy' },
      {},
      {},
    );
  }

  it('uses stored Vyper immutable references for pre-run compiler outputs without IR', () => {
    const immutableReferences = {
      '0': [{ length: 32, start: 3 }],
    };
    const preRunCompilation = createPreRunVyperCompilation(immutableReferences);

    expect(preRunCompilation.immutableReferences).to.deep.equal(
      immutableReferences,
    );
  });

  it('does not infer missing Vyper immutable references for pre-run compiler outputs', () => {
    const preRunCompilation = createPreRunVyperCompilation();

    expect(preRunCompilation.immutableReferences).to.deep.equal({});
  });
});
