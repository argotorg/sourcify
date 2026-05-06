import { describe, it } from 'mocha';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ZkSolcCompilation } from '../../src/Compilation/ZkSolcCompilation';
import {
  findZkSolcVersionInBytecode,
  getZkSolcVersionCandidates,
} from '../../src/Compilation/ZkSolcVersionSelection';
import {
  CompilationError,
  type CompilationTarget,
  type IZkSolcCompiler,
} from '../../src/Compilation/CompilationTypes';
import type {
  LinkReferences,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
} from '@ethereum-sourcify/compilers-types';

use(chaiAsPromised);

const compilationTarget: CompilationTarget = {
  path: 'contracts/Storage.sol',
  name: 'Storage',
};

const source = {
  content: 'contract Storage { uint256 value; }',
};

function makeMetadata(solcVersion: string) {
  return JSON.stringify({
    compiler: {
      version: solcVersion,
    },
    language: 'Solidity',
    output: {
      abi: [],
    },
    settings: {},
    sources: {},
    version: 1,
  });
}

function makeJsonInput(
  outputSelection?: SolidityJsonInput['settings']['outputSelection'],
): SolidityJsonInput {
  return {
    language: 'Solidity',
    sources: {
      [compilationTarget.path]: source,
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection,
    },
  };
}

function makeContract(
  overrides: Partial<SolidityOutputContract> = {},
): SolidityOutputContract {
  return {
    abi: [],
    metadata: makeMetadata('0.8.24'),
    evm: {
      bytecode: {
        object: '010203',
      },
      deployedBytecode: {
        object: '',
      },
    },
    ...overrides,
  };
}

function makeCompiler(contract: SolidityOutputContract): IZkSolcCompiler & {
  calls: Array<{
    zksolcVersion: string;
    solcVersion: string;
    solcJsonInput: SolidityJsonInput;
  }>;
} {
  return {
    calls: [],
    async compile(
      zksolcVersion: string,
      solcVersion: string,
      solcJsonInput: SolidityJsonInput,
    ): Promise<SolidityOutput> {
      this.calls.push({
        zksolcVersion,
        solcVersion,
        solcJsonInput,
      });
      return {
        contracts: {
          [compilationTarget.path]: {
            [compilationTarget.name]: contract,
          },
        },
      };
    },
  };
}

describe('ZkSolcCompilation', () => {
  it('should compile with zksolc and solc versions', async () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      'v1.5.3',
      '0.8.24',
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compiler.calls).to.have.length(1);
    expect(compiler.calls[0].zksolcVersion).to.equal('v1.5.3');
    expect(compiler.calls[0].solcVersion).to.equal('0.8.24');
    expect(compilation.creationBytecode).to.equal('0x010203');
    expect(compilation.runtimeBytecode).to.equal('0x010203');
    expect(compilation.metadata?.compiler.version).to.equal('0.8.24');
  });

  it('should preserve non-semver zksolc versions for the compiler', async () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      'vm-1.5.0-a167aa3',
      '0.8.24-1.0.1',
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compiler.calls[0].zksolcVersion).to.equal('vm-1.5.0-a167aa3');
    expect(compiler.calls[0].solcVersion).to.equal('0.8.24-1.0.1');
  });

  it('should preserve solc release strings with v prefix and commit hash', async () => {
    const solcVersion = 'v0.8.26+commit.8a97fa7a';
    const compiler = makeCompiler(
      makeContract({
        metadata: makeMetadata(solcVersion),
      }),
    );
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.10',
      solcVersion,
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compiler.calls[0].solcVersion).to.equal(solcVersion);
    expect(compilation.solcCompilerVersion).to.equal(solcVersion);
    expect(compilation.metadata?.compiler.version).to.equal(solcVersion);
  });

  for (const { zksolcVersion, solcVersion } of [
    { zksolcVersion: '1.4.1', solcVersion: '0.8.4-1.0.1' },
    { zksolcVersion: '1.3.17', solcVersion: '0.7.6-1.0.1' },
  ]) {
    it(`should compile pre-1.5 zksolc ${zksolcVersion} with era solc ${solcVersion}`, async () => {
      const compiler = makeCompiler(
        makeContract({
          metadata: makeMetadata(solcVersion),
        }),
      );
      const compilation = new ZkSolcCompilation(
        compiler,
        zksolcVersion,
        solcVersion,
        makeJsonInput(),
        compilationTarget,
      );

      await compilation.compile();

      expect(compiler.calls).to.have.length(1);
      expect(compiler.calls[0].zksolcVersion).to.equal(zksolcVersion);
      expect(compiler.calls[0].solcVersion).to.equal(solcVersion);
      expect(compilation.zksolcVersion).to.equal(zksolcVersion);
      expect(compilation.solcCompilerVersion).to.equal(solcVersion);
      expect(compilation.runtimeBytecode).to.equal('0x010203');
      expect(compilation.metadata?.compiler.version).to.equal(solcVersion);
      expect(
        compiler.calls[0].solcJsonInput.settings.outputSelection,
      ).to.deep.equal({
        '*': {
          '*': ['abi', 'metadata', 'evm'],
          '': ['abi'],
        },
        [compilationTarget.path]: {
          [compilationTarget.name]: ['abi', 'metadata', 'evm'],
        },
      });
    });
  }

  it('should preserve existing output selection and add zksolc outputs', () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.3',
      '0.8.24',
      makeJsonInput({
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
          '': ['ast'],
        },
        [compilationTarget.path]: {
          [compilationTarget.name]: ['storageLayout'],
        },
      }),
      compilationTarget,
    );

    expect(compilation.jsonInput.settings.outputSelection).to.deep.equal({
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'metadata', 'evm'],
        '': ['ast', 'abi'],
      },
      [compilationTarget.path]: {
        [compilationTarget.name]: ['storageLayout', 'abi', 'metadata', 'evm'],
      },
    });
  });

  it('should repair unusable output selection entries', () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.3',
      '0.8.24',
      makeJsonInput({
        '*': {
          '*': 'abi',
        },
        [compilationTarget.path]: [] as any,
      }),
      compilationTarget,
    );

    expect(compilation.jsonInput.settings.outputSelection).to.deep.equal({
      '*': {
        '*': ['abi', 'metadata', 'evm'],
        '': ['abi'],
      },
      [compilationTarget.path]: {
        [compilationTarget.name]: ['abi', 'metadata', 'evm'],
      },
    });
  });

  it('should expose EraVM bytecode when deployedBytecode is absent', async () => {
    const compiler = makeCompiler(
      makeContract({
        evm: {
          bytecode: {
            object: 'aabbcc',
          },
        } as any,
      }),
    );
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.3',
      '0.8.24',
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compilation.creationBytecode).to.equal('0xaabbcc');
    expect(compilation.runtimeBytecode).to.equal('0xaabbcc');
  });

  it('should use EraVM bytecode link references for creation and runtime', async () => {
    const linkReferences: LinkReferences = {
      'contracts/Library.sol': {
        Library: [
          {
            start: 8,
            length: 20,
          },
        ],
      },
    };
    const compiler = makeCompiler(
      makeContract({
        evm: {
          bytecode: {
            object: '010203',
            linkReferences,
          },
          deployedBytecode: {
            object: '',
          },
        },
      }),
    );
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.3',
      '0.8.24',
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compilation.runtimeLinkReferences).to.deep.equal(linkReferences);
    expect(compilation.creationLinkReferences).to.deep.equal(linkReferences);
    expect(compilation.immutableReferences).to.deep.equal({});
  });

  it('should set empty CBOR auxdata positions', async () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.3',
      '0.8.24',
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();

    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({});
    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({});
  });

  it('should throw when the compilation target is missing', async () => {
    const compiler: IZkSolcCompiler = {
      async compile(): Promise<SolidityOutput> {
        return {
          contracts: {},
        };
      },
    };
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.3',
      '0.8.24',
      makeJsonInput(),
      compilationTarget,
    );

    await expect(compilation.compile())
      .to.be.rejectedWith(CompilationError)
      .and.eventually.have.property(
        'code',
        'contract_not_found_in_compiler_output',
      );
  });
});

describe('ZkSolcVersionSelection', () => {
  it('should prefer an explicit requested zksolc version', () => {
    expect(
      getZkSolcVersionCandidates({
        requestedZkSolcVersion: '1.4.1',
        availableZkSolcVersions: ['1.5.10', '1.4.1', '1.3.17'],
      }),
    ).to.deep.equal(['1.4.1']);
  });

  it('should use a bytecode zksolc indicator before falling back', () => {
    const bytecodeIndicator = Buffer.from(
      'zksolc:1.4.1;solc:0.8.4;llvm:1.0.1',
      'utf8',
    ).toString('hex');

    expect(findZkSolcVersionInBytecode(bytecodeIndicator)).to.equal('1.4.1');
    expect(
      getZkSolcVersionCandidates({
        availableZkSolcVersions: ['1.5.10', 'v1.4.1', '1.3.17'],
        bytecodes: [bytecodeIndicator],
      }),
    ).to.deep.equal(['v1.4.1', '1.5.10', '1.3.17']);
  });

  it('should try available zksolc versions newest-first without indicators', () => {
    expect(
      getZkSolcVersionCandidates({
        availableZkSolcVersions: ['1.4.1', '1.5.10', '1.3.17'],
      }),
    ).to.deep.equal(['1.5.10', '1.4.1', '1.3.17']);
  });
});
