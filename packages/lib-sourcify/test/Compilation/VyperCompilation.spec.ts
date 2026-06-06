import { describe, it } from 'mocha';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import path from 'path';
import fs from 'fs';
import {
  returnLegacyVyperImmutableReferences,
  VyperCompilation,
} from '../../src/Compilation/VyperCompilation';
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
  it('derives a synthetic tail reference from the real Vyper 0.3.7 AST', async () => {
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

    const ast = compilation.compilerOutput?.sources?.[contractFileName]?.ast;
    const targetDecl = ast?.body.find(
      (node: any) => node.ast_type === 'VariableDecl',
    );
    expect(targetDecl?.target?.id).to.equal('TARGET');
    expect(
      returnLegacyVyperImmutableReferences(
        compilation.compilerOutput,
        contractFileName,
        compilation.runtimeBytecode,
      ),
    ).to.deep.equal({
      '0': [{ length: 32, start: 88 }],
    });
  });

  it('derives a synthetic tail reference from real Vyper 0.3.7 mixed public and non-public immutable ASTs', async () => {
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

    const ast = compilation.compilerOutput?.sources?.[contractFileName]?.ast;
    const declarations = ast?.body.filter(
      (node: any) => node.ast_type === 'VariableDecl',
    );
    const targetDecl = declarations?.find(
      (node: any) => node.target?.id === 'TARGET',
    );
    const saltDecl = declarations?.find(
      (node: any) => node.target?.id === 'SALT',
    );
    const coinsDecl = declarations?.find(
      (node: any) => node.target?.id === 'COINS',
    );
    const underlyingCoinsDecl = declarations?.find(
      (node: any) => node.target?.id === 'UNDERLYING_COINS',
    );
    expect(targetDecl?.target?.id).to.equal('TARGET');
    expect(targetDecl?.is_public).to.equal(true);
    expect(targetDecl?.is_immutable).to.equal(true);
    expect(targetDecl?.annotation?.id).to.equal('address');
    expect(saltDecl?.target?.id).to.equal('SALT');
    expect(saltDecl?.is_public).to.equal(false);
    expect(saltDecl?.is_immutable).to.equal(true);
    expect(saltDecl?.annotation?.id).to.equal('bytes32');
    expect(coinsDecl?.is_immutable).to.equal(true);
    expect(coinsDecl?.annotation?.slice?.value?.id).to.equal('N_COINS');
    expect(underlyingCoinsDecl?.is_immutable).to.equal(true);
    expect(underlyingCoinsDecl?.annotation?.slice?.value?.id).to.equal(
      'N_UL_COINS',
    );
    expect(
      returnLegacyVyperImmutableReferences(
        compilation.compilerOutput,
        contractFileName,
        compilation.runtimeBytecode,
      ),
    ).to.deep.equal({
      '0': [{ length: 256, start: compilation.runtimeBytecode.length / 2 - 1 }],
    });
  });

  it('derives a synthetic tail reference from unwrapped Vyper 0.3.7 immutable annotations', () => {
    const compilerOutput = {
      sources: {
        'test.vy': {
          id: 0,
          ast: moduleAst([
            variableDecl('A', subscript(name('uint256'), 3)),
            variableDecl('B', subscript(name('String'), 10)),
          ]),
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        'test.vy',
        '0x6000',
      ),
    ).to.deep.equal({
      '0': [{ length: 160, start: 2 }],
    });
  });

  it('derives a synthetic tail reference from wrapped Vyper 0.3.4-0.3.6 immutable annotations', () => {
    const compilerOutput = {
      sources: {
        'test.vy': {
          id: 0,
          ast: moduleAst([
            variableDecl('A', immutableCall(subscript(name('uint256'), 3))),
            variableDecl('B', immutableCall(subscript(name('String'), 10))),
          ]),
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        'test.vy',
        '0x6000',
      ),
    ).to.deep.equal({
      '0': [{ length: 160, start: 2 }],
    });
  });

  it('derives a synthetic tail reference from old Vyper 0.3.1-0.3.3 AnnAssign immutables', () => {
    const compilerOutput = {
      sources: {
        'test.vy': {
          id: 0,
          ast: moduleAst([
            annAssign('A', immutableCall(subscript(name('uint256'), 3))),
            annAssign('B', immutableCall(subscript(name('String'), 10))),
          ]),
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        'test.vy',
        '0x6000',
      ),
    ).to.deep.equal({
      '0': [{ length: 160, start: 2 }],
    });
  });

  it('resolves legacy Vyper integer constants in immutable array bounds', () => {
    const compilerOutput = {
      sources: {
        'test.vy': {
          id: 0,
          ast: moduleAst([
            annAssign('N_COINS', constantCall(name('int128')), int(2)),
            annAssign('N_STABLECOINS', constantCall(name('int128')), int(3)),
            annAssign(
              'N_UL_COINS',
              constantCall(name('int128')),
              binOp(
                binOp(name('N_COINS'), 'Add', name('N_STABLECOINS')),
                'Sub',
                int(1),
              ),
            ),
            annAssign(
              'COINS',
              immutableCall(
                subscriptWithLength(name('address'), name('N_COINS')),
              ),
            ),
            annAssign(
              'UNDERLYING_COINS',
              immutableCall(
                subscriptWithLength(name('address'), name('N_UL_COINS')),
              ),
            ),
          ]),
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        'test.vy',
        '0x6000',
      ),
    ).to.deep.equal({
      '0': [{ length: 192, start: 2 }],
    });
  });

  it('derives a synthetic tail reference for structs and dynamic arrays', () => {
    const compilerOutput = {
      sources: {
        'test.vy': {
          id: 0,
          ast: moduleAst([
            structDef('MyStruct', [
              ['a', name('uint256')],
              ['b', name('address')],
            ]),
            variableDecl('C', name('MyStruct')),
            variableDecl('D', dynArray(name('uint256'), 3)),
          ]),
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        'test.vy',
        '0x60',
      ),
    ).to.deep.equal({
      '0': [{ length: 192, start: 1 }],
    });
  });

  it('only checks the compilation target source for immutable declarations', () => {
    const compilerOutput = {
      sources: {
        'target.vy': {
          id: 0,
          ast: {
            ast_type: 'Module',
            body: [{ ast_type: 'FunctionDef' }],
          },
        },
        'unused.vy': {
          id: 1,
          ast: moduleAst([variableDecl('A', name('uint256'))]),
        },
      },
    };

    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        'target.vy',
        '0x6000',
      ),
    ).to.deep.equal({});
    expect(
      returnLegacyVyperImmutableReferences(
        compilerOutput as any,
        'unused.vy',
        '0x6000',
      ),
    ).to.deep.equal({
      '0': [{ length: 32, start: 2 }],
    });
  });
});

function moduleAst(body: any[]) {
  return { ast_type: 'Module', body };
}

function name(id: string) {
  return { ast_type: 'Name', id };
}

function int(value: number) {
  return { ast_type: 'Int', value };
}

function subscript(value: any, length: number) {
  return subscriptWithLength(value, int(length));
}

function subscriptWithLength(value: any, length: any) {
  return {
    ast_type: 'Subscript',
    value,
    slice: {
      ast_type: 'Index',
      value: length,
    },
  };
}

function dynArray(subtype: any, maxLength: number) {
  return {
    ast_type: 'Subscript',
    value: name('DynArray'),
    slice: {
      ast_type: 'Index',
      value: {
        ast_type: 'Tuple',
        elements: [subtype, int(maxLength)],
      },
    },
  };
}

function immutableCall(annotation: any) {
  return {
    ast_type: 'Call',
    func: name('immutable'),
    args: [annotation],
  };
}

function constantCall(annotation: any) {
  return {
    ast_type: 'Call',
    func: name('constant'),
    args: [annotation],
  };
}

function binOp(left: any, op: string, right: any) {
  return {
    ast_type: 'BinOp',
    left,
    op: {
      ast_type: op,
    },
    right,
  };
}

function variableDecl(variableName: string, annotation: any) {
  return {
    ast_type: 'VariableDecl',
    is_immutable: true,
    target: name(variableName),
    annotation,
  };
}

function annAssign(variableName: string, annotation: any, value?: any) {
  const node: any = {
    ast_type: 'AnnAssign',
    target: name(variableName),
    annotation,
  };
  if (value !== undefined) {
    node.value = value;
  }
  return node;
}

function structDef(structName: string, members: Array<[string, any]>) {
  return {
    ast_type: 'StructDef',
    name: structName,
    body: members.map(([memberName, annotation]) =>
      annAssign(memberName, annotation),
    ),
  };
}
