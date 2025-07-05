import { describe, it } from 'mocha';
import { expect } from 'chai';
import path from 'path';
import fs from 'fs';
import { VyperCompilation } from '../../src/Compilation/VyperCompilation';
import { vyperCompiler } from '../utils';
import { id } from 'ethers';

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

    // Mock vyperCompiler to return output without metadata
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

  it('Should mock a metadata object for a Vyper contract', async () => {
    const contractPath = path.join(
      __dirname,
      '..',
      'sources',
      'Vyper',
      'testcontract',
    );
    const contractFileName = 'test.vy';
    const contractName = contractFileName.split('.')[0];
    const contractContent = fs.readFileSync(
      path.join(contractPath, contractFileName),
      'utf8',
    );

    const vyperVersion = '0.3.10+commit.91361694';

    const compilation = new VyperCompilation(
      vyperCompiler,
      vyperVersion,
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

    expect(compilation.metadata).to.deep.equal({
      compiler: { version: vyperVersion },
      language: 'Vyper',
      output: {
        abi: [
          {
            inputs: [],
            name: 'helloWorld',
            outputs: [
              {
                name: '',
                type: 'string',
              },
            ],
            stateMutability: 'view',
            type: 'function',
          },
        ],
        devdoc: {},
        userdoc: {},
      },
      settings: {
        ...compilation.jsonInput.settings,
        compilationTarget: { [contractFileName]: contractName },
      },
      sources: {
        [contractFileName]: {
          keccak256: id(contractContent),
        },
      },
      version: 1,
    });
  });
});
