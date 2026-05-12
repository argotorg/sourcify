import { describe, it } from 'mocha';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  getZkSolcCompilerVersionCandidates,
  ZkSolcCompilation,
} from '../../src/Compilation/ZkSolcCompilation';
import { Verification } from '../../src/Verification/Verification';
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

function makeCompilerBySolcVersion(
  contractsBySolcVersion: Record<string, SolidityOutputContract | Error>,
): IZkSolcCompiler & {
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
      const contractOrError = contractsBySolcVersion[solcVersion];
      if (contractOrError instanceof Error) {
        throw contractOrError;
      }
      if (!contractOrError) {
        throw new Error(`Unexpected solc version: ${solcVersion}`);
      }
      return {
        contracts: {
          [compilationTarget.path]: {
            [compilationTarget.name]: contractOrError,
          },
        },
      };
    },
  };
}

describe('ZkSolcCompilation', () => {
  it('should compile with zksolc and solc versions', async () => {
    const solcVersion = '0.8.24-1.0.1';
    const compiler = makeCompiler(
      makeContract({
        metadata: makeMetadata(solcVersion),
      }),
    );
    const compilation = new ZkSolcCompilation(
      compiler,
      'v1.5.3',
      solcVersion,
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compiler.calls).to.have.length(1);
    expect(compiler.calls[0].zksolcVersion).to.equal('v1.5.3');
    expect(compiler.calls[0].solcVersion).to.equal(solcVersion);
    expect(compilation.creationBytecode).to.equal('0x010203');
    expect(compilation.runtimeBytecode).to.equal('0x010203');
    expect(compilation.metadata?.compiler.version).to.equal(solcVersion);
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

  it('should expand solc release strings with v prefix and commit hash to era-solc candidates', async () => {
    const solcVersion = 'v0.8.26+commit.8a97fa7a';
    const compiler = makeCompiler(
      makeContract({
        metadata: makeMetadata('0.8.26-1.0.2'),
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

    expect(compiler.calls[0].solcVersion).to.equal('0.8.26-1.0.2');
    expect(compilation.requestedSolcCompilerVersion).to.equal(solcVersion);
    expect(compilation.solcCompilerVersion).to.equal('0.8.26-1.0.2');
    expect(compilation.metadata?.compiler.version).to.equal('0.8.26-1.0.2');
  });

  it('should accept object metadata from zksolc output', async () => {
    const metadata = JSON.parse(makeMetadata('0.8.26-1.0.2'));
    const compiler = makeCompiler(
      makeContract({
        metadata,
      } as any),
    );
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.7',
      '0.8.26-1.0.2',
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compilation.metadata).to.deep.equal(metadata);
  });

  it('should retry era-solc candidates when compilation fails', async () => {
    const solcVersion = 'v0.8.26+commit.8a97fa7a';
    const compiler = makeCompilerBySolcVersion({
      '0.8.26-1.0.2': new Error('unsupported era-solc candidate'),
      '0.8.26-1.0.1': makeContract({
        metadata: makeMetadata('0.8.26-1.0.1'),
      }),
    });
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.7',
      solcVersion,
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compiler.calls.map((call) => call.solcVersion)).to.deep.equal([
      '0.8.26-1.0.2',
      '0.8.26-1.0.1',
    ]);
    expect(compilation.solcCompilerVersion).to.equal('0.8.26-1.0.1');
    expect(compilation.metadata?.compiler.version).to.equal('0.8.26-1.0.1');
  });

  it('should retry era-solc candidates when bytecode matching fails', async () => {
    const solcVersion = 'v0.8.26+commit.8a97fa7a';
    const compiler = makeCompilerBySolcVersion({
      '0.8.26-1.0.2': makeContract({
        metadata: makeMetadata('0.8.26-1.0.2'),
        evm: {
          bytecode: {
            object: '999999',
          },
          deployedBytecode: {
            object: '',
          },
        },
      }),
      '0.8.26-1.0.1': makeContract({
        metadata: makeMetadata('0.8.26-1.0.1'),
        evm: {
          bytecode: {
            object: '010203',
          },
          deployedBytecode: {
            object: '',
          },
        },
      }),
    });
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.5.7',
      solcVersion,
      makeJsonInput(),
      compilationTarget,
    );
    const verification = new Verification(
      compilation,
      {
        chainId: 2741,
        async getBytecode() {
          return '0x010203';
        },
      } as any,
      '0xbc176Ac2373614F9858A118917d83b139bcb3f8c',
    );

    await verification.verify();

    expect(compiler.calls.map((call) => call.solcVersion)).to.deep.equal([
      '0.8.26-1.0.2',
      '0.8.26-1.0.1',
    ]);
    expect(compilation.solcCompilerVersion).to.equal('0.8.26-1.0.1');
    expect(verification.status.runtimeMatch).to.equal('partial');
    expect(verification.export().compilation).to.include({
      compiler: 'zksolc',
      compilerVersion: '1.5.7',
    });
    expect(verification.export().compilation.zksolc).to.deep.equal({
      solcCompilerVersion: '0.8.26-1.0.1',
    });
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
          '*': ['abi', 'metadata'],
          '': ['abi'],
        },
        [compilationTarget.path]: {
          [compilationTarget.name]: ['abi', 'metadata'],
        },
      });
    });
  }

  it('should omit aggregate evm output selection for pre-1.5 zksolc', () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      '1.3.19',
      '0.6.12-1.0.1',
      makeJsonInput({
        '*': {
          '*': ['abi'],
        },
      }),
      compilationTarget,
    );

    expect(compilation.jsonInput.settings.outputSelection).to.deep.equal({
      '*': {
        '*': ['abi', 'metadata'],
        '': ['abi'],
      },
      [compilationTarget.path]: {
        [compilationTarget.name]: ['abi', 'metadata'],
      },
    });
  });

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

  it('should set EraVM bytecode hash auxdata positions', async () => {
    const bytecodeHash = '11'.repeat(32);
    const compiler = makeCompiler(
      makeContract({
        evm: {
          bytecode: {
            object: `010203${bytecodeHash}`,
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
    await compilation.generateCborAuxdataPositions();

    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': {
        offset: 3,
        value: `0x${bytecodeHash}`,
      },
    });
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

describe('ZkSolcCompilerVersionCandidates', () => {
  it('should expand supported Solidity release strings newest-first', () => {
    expect(
      getZkSolcCompilerVersionCandidates('v0.8.26+commit.8a97fa7a', 'v1.5.7'),
    ).to.deep.equal(['0.8.26-1.0.2', '0.8.26-1.0.1']);
  });

  it('should include era-solc 1.0.0 only for supported older Solidity versions', () => {
    expect(
      getZkSolcCompilerVersionCandidates('v0.8.24+commit.e11b9ed9', 'v1.5.7'),
    ).to.deep.equal(['0.8.24-1.0.2', '0.8.24-1.0.1', '0.8.24-1.0.0']);

    expect(
      getZkSolcCompilerVersionCandidates('v0.8.26+commit.8a97fa7a', 'v1.5.7'),
    ).not.to.include('0.8.26-1.0.0');
  });

  it('should omit era-solc 1.0.2 for pre-1.5 zksolc versions', () => {
    expect(getZkSolcCompilerVersionCandidates('0.8.4', '1.4.1')).to.deep.equal([
      '0.8.4-1.0.1',
      '0.8.4-1.0.0',
    ]);
    expect(getZkSolcCompilerVersionCandidates('0.7.6', '1.3.17')).to.deep.equal(
      ['0.7.6-1.0.1', '0.7.6-1.0.0'],
    );
  });

  it('should preserve supported exact era-solc versions', () => {
    expect(
      getZkSolcCompilerVersionCandidates('zkVM-0.8.19-1.0.0', '1.5.7'),
    ).to.deep.equal(['0.8.19-1.0.0']);
  });

  it('should reject unsupported exact era-solc combinations', () => {
    expect(
      getZkSolcCompilerVersionCandidates('0.8.26-1.0.0', '1.5.7'),
    ).to.deep.equal([]);
    expect(
      getZkSolcCompilerVersionCandidates('0.8.4-1.0.2', '1.4.1'),
    ).to.deep.equal([]);
  });
});
