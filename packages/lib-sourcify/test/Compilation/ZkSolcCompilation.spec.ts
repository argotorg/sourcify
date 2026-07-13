import { describe, it } from 'mocha';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  getZkSolcCompilerVersionCandidates,
  formatZkSolcCompilerVersion,
  parseZkSolcCompilerVersion,
  isZkSolcCompilerVersion,
  ZkSolcCompilation,
} from '../../src/Compilation/ZkSolcCompilation';
// Used only to observe compilation artifacts through Verification.export()
// (forced output selection + EraVM link-reference derivation); this file has no
// matching/verification tests — those live in ../Verification/ZkSolcVerification.spec.ts.
import { Verification } from '../../src/Verification/Verification';
import { PreRunCompilation } from '../../src/Compilation/PreRunCompilation';
import {
  CompilationError,
  type IZkSolcCompiler,
} from '../../src/Compilation/CompilationTypes';
import { solc } from '../utils';
import type {
  LinkReferences,
  SolidityOutput,
} from '@ethereum-sourcify/compilers-types';
import { AuxdataStyle } from '@ethereum-sourcify/bytecode-utils';
import {
  ABSTRACT_ZKSYNC_1_3_19_TAIL,
  ABSTRACT_ZKSYNC_1_5_7_TAIL,
  ABSTRACT_ZKSYNC_1_5_15_TAIL,
  compilationTarget,
  makeCompiler,
  makeContract,
  makeJsonInput,
  makeMetadata,
  strip0x,
} from '../utils/zksolcTestHelpers';

use(chaiAsPromised);

describe('ZkSolcCompilation', () => {
  it('parses, formats, and detects the combined compiler version string', () => {
    expect(formatZkSolcCompilerVersion('1.5.16', '0.8.26-1.0.2')).to.equal(
      'zksolc:1.5.16;solc:0.8.26-1.0.2',
    );
    expect(
      parseZkSolcCompilerVersion('zksolc:1.5.16;solc:0.8.26-1.0.2'),
    ).to.deep.equal({
      zksolcVersion: '1.5.16',
      solcCompilerVersion: '0.8.26-1.0.2',
    });
    // round-trips an upstream solc backend too
    expect(
      parseZkSolcCompilerVersion('zksolc:1.4.0;solc:0.8.20+commit.a4f2e591'),
    ).to.deep.equal({
      zksolcVersion: '1.4.0',
      solcCompilerVersion: '0.8.20+commit.a4f2e591',
    });
    expect(isZkSolcCompilerVersion('zksolc:1.5.16;solc:0.8.26-1.0.2')).to.equal(
      true,
    );
    expect(isZkSolcCompilerVersion('0.8.26+commit.8a97fa7a')).to.equal(false);
    expect(() => parseZkSolcCompilerVersion('zksolc:1.5.16')).to.throw(
      CompilationError,
    );
  });

  it('keeps the combined toolchain string as the compiler version', () => {
    const compilation = new ZkSolcCompilation(
      makeCompiler(makeContract()),
      'zksolc:1.5.16;solc:0.8.26-1.0.2',
      makeJsonInput(),
      compilationTarget,
    );
    expect(compilation.compilerVersion).to.equal(
      'zksolc:1.5.16;solc:0.8.26-1.0.2',
    );
    expect(compilation.zksolcVersion).to.equal('1.5.16');
    expect(compilation.solcCompilerVersion).to.equal('0.8.26-1.0.2');
    expect(compilation.compilerName).to.equal('zksolc');
  });

  it('should compile with zksolc and solc versions', async () => {
    const solcVersion = '0.8.24-1.0.1';
    const compiler = makeCompiler(
      makeContract({
        metadata: makeMetadata(solcVersion),
      }),
    );
    const compilation = new ZkSolcCompilation(
      compiler,
      `zksolc:v1.5.3;solc:${solcVersion}`,
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
    expect(compilation.auxdataStyle).to.equal(AuxdataStyle.ZKSYNC);
    expect(compilation.compilerName).to.equal('zksolc');
    expect(compilation.compilerVersion).to.equal(
      `zksolc:v1.5.3;solc:${solcVersion}`,
    );
    expect(compilation.solcCompilerVersion).to.equal(solcVersion);
  });

  it('should preserve non-semver zksolc versions for the compiler', async () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      'zksolc:vm-1.5.0-a167aa3;solc:0.8.24-1.0.1',
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compiler.calls[0].zksolcVersion).to.equal('vm-1.5.0-a167aa3');
    expect(compiler.calls[0].solcVersion).to.equal('0.8.24-1.0.1');
  });

  it('should compile with the exact upstream solc release string passed', async () => {
    const solcVersion = 'v0.8.26+commit.8a97fa7a';
    const compiler = makeCompiler(
      makeContract({
        metadata: makeMetadata(solcVersion),
      }),
    );
    const compilation = new ZkSolcCompilation(
      compiler,
      `zksolc:1.5.10;solc:${solcVersion}`,
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compiler.calls[0].solcVersion).to.equal(solcVersion);
    expect(compilation.solcCompilerVersion).to.equal(solcVersion);
    expect(compilation.metadata?.compiler.version).to.equal(solcVersion);
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
      'zksolc:1.5.7;solc:0.8.26-1.0.2',
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compilation.metadata).to.deep.equal(metadata);
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
        `zksolc:${zksolcVersion};solc:${solcVersion}`,
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
          '*': ['abi', 'storageLayout', 'metadata', 'userdoc', 'devdoc'],
          '': ['abi'],
        },
        [compilationTarget.path]: {
          [compilationTarget.name]: [
            'abi',
            'storageLayout',
            'metadata',
            'userdoc',
            'devdoc',
          ],
        },
      });
    });
  }

  it('should force only older supported output selections for zksolc 1.3.5', () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      'zksolc:1.3.5;solc:0.6.12-1.0.1',
      makeJsonInput(),
      compilationTarget,
    );

    expect(compilation.jsonInput.settings.outputSelection).to.deep.equal({
      '*': {
        '*': ['abi', 'storageLayout'],
        '': ['abi'],
      },
      [compilationTarget.path]: {
        [compilationTarget.name]: ['abi', 'storageLayout'],
      },
    });
  });

  it('should omit aggregate evm output selection for pre-1.5 zksolc', () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      'zksolc:1.3.19;solc:0.6.12-1.0.1',
      makeJsonInput({
        '*': {
          '*': ['abi'],
        },
      }),
      compilationTarget,
    );

    expect(compilation.jsonInput.settings.outputSelection).to.deep.equal({
      '*': {
        '*': ['abi', 'storageLayout', 'metadata', 'userdoc', 'devdoc'],
        '': ['abi'],
      },
      [compilationTarget.path]: {
        [compilationTarget.name]: [
          'abi',
          'storageLayout',
          'metadata',
          'userdoc',
          'devdoc',
        ],
      },
    });
  });

  it('should preserve existing output selection and add zksolc outputs', () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      'zksolc:1.5.3;solc:0.8.24',
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
        '*': [
          'abi',
          'evm.bytecode.object',
          'storageLayout',
          'metadata',
          'userdoc',
          'devdoc',
          'evm',
        ],
        '': ['ast', 'abi'],
      },
      [compilationTarget.path]: {
        [compilationTarget.name]: [
          'storageLayout',
          'abi',
          'metadata',
          'userdoc',
          'devdoc',
          'evm',
        ],
      },
    });
  });

  it('should repair unusable output selection entries', () => {
    const compiler = makeCompiler(makeContract());
    const compilation = new ZkSolcCompilation(
      compiler,
      'zksolc:1.5.3;solc:0.8.24',
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
        '*': ['abi', 'storageLayout', 'metadata', 'userdoc', 'devdoc', 'evm'],
        '': ['abi'],
      },
      [compilationTarget.path]: {
        [compilationTarget.name]: [
          'abi',
          'storageLayout',
          'metadata',
          'userdoc',
          'devdoc',
          'evm',
        ],
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
      'zksolc:1.5.3;solc:0.8.24',
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
      'zksolc:1.5.3;solc:0.8.24',
      makeJsonInput(),
      compilationTarget,
    );

    await compilation.compile();

    expect(compilation.runtimeLinkReferences).to.deep.equal(linkReferences);
    expect(compilation.creationLinkReferences).to.deep.equal(linkReferences);
    expect(compilation.immutableReferences).to.deep.equal({});
  });

  it('should export forced generic EraVM artifacts and bytecode link references', async () => {
    const userdoc = {
      kind: 'user',
      methods: {
        'value()': {
          notice: 'Returns the stored value.',
        },
      },
      version: 1,
    } as const;
    const devdoc = {
      kind: 'dev',
      methods: {
        'value()': {
          details: 'Reads the value slot.',
        },
      },
      version: 1,
    } as const;
    const storageLayout = {
      storage: [
        {
          astId: 1,
          contract: 'contracts/Storage.sol:Storage',
          label: 'value',
          offset: 0,
          slot: '0',
          type: 't_uint256',
        },
      ],
      types: {
        t_uint256: {
          encoding: 'inplace',
          label: 'uint256',
          numberOfBytes: '32',
        },
      },
    };
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
        userdoc,
        devdoc,
        storageLayout,
        evm: {
          bytecode: {
            object: strip0x(ABSTRACT_ZKSYNC_1_5_15_TAIL),
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
      'zksolc:1.5.15;solc:0.8.26-1.0.2',
      makeJsonInput(),
      compilationTarget,
    );
    const verification = new Verification(
      compilation,
      {
        chainId: 2741,
        async getBytecode() {
          return ABSTRACT_ZKSYNC_1_5_15_TAIL;
        },
      } as any,
      '0x0929d81a73a83b73e5de2ba63a15ce2a18addbe2',
    );

    await verification.verify();

    const exported = verification.export();
    const contractOutput = exported.compilation.contractCompilerOutput;
    expect(contractOutput.userdoc).to.deep.equal(userdoc);
    expect(contractOutput.devdoc).to.deep.equal(devdoc);
    expect(contractOutput.storageLayout).to.deep.equal(storageLayout);
    expect(contractOutput.evm.bytecode.linkReferences).to.deep.equal(
      linkReferences,
    );
    expect(contractOutput.evm.deployedBytecode.linkReferences).to.deep.equal(
      linkReferences,
    );
    expect(exported.compilation.creationBytecodeCborAuxdata).to.deep.equal({});
    expect(exported.compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': {
        offset: 128,
        value: `0x${strip0x(ABSTRACT_ZKSYNC_1_5_15_TAIL).slice(128 * 2)}`,
      },
    });
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
      'zksolc:1.5.3;solc:0.8.24',
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

  it('should set EraVM CBOR auxdata positions with alignment padding', async () => {
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

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();

    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': {
        offset: 128,
        value: `0x${strip0x(ABSTRACT_ZKSYNC_1_5_15_TAIL).slice(128 * 2)}`,
      },
    });
    expect(compilation.creationBytecodeCborAuxdata).to.deep.equal({});
  });

  it('should include EraVM zero-word padding in bare hash auxdata positions', async () => {
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

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();

    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({
      '1': {
        offset: 192,
        value: `0x${strip0x(ABSTRACT_ZKSYNC_1_3_19_TAIL).slice(192 * 2)}`,
      },
    });
  });

  it('should omit EraVM bare hash auxdata positions when metadata is disabled', async () => {
    const compiler = makeCompiler(
      makeContract({
        evm: {
          bytecode: {
            object: strip0x(ABSTRACT_ZKSYNC_1_5_7_TAIL),
          },
          deployedBytecode: {
            object: '',
          },
        },
      }),
    );
    const jsonInput = makeJsonInput();
    (jsonInput.settings as any).metadata = {
      bytecodeHash: 'none',
      appendCBOR: false,
    };
    const compilation = new ZkSolcCompilation(
      compiler,
      'zksolc:1.5.7;solc:0.8.26-1.0.1',
      jsonInput,
      compilationTarget,
    );

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();

    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({});
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
      'zksolc:1.5.3;solc:0.8.24',
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
  it('should try exact commit-bearing Solidity release strings before era-solc candidates', () => {
    expect(
      getZkSolcCompilerVersionCandidates('v0.8.26+commit.8a97fa7a', 'v1.5.7'),
    ).to.deep.equal([
      'v0.8.26+commit.8a97fa7a',
      '0.8.26-1.0.2',
      '0.8.26-1.0.1',
    ]);
  });

  it('should include era-solc 1.0.0 only for supported older Solidity versions', () => {
    expect(
      getZkSolcCompilerVersionCandidates('v0.8.24+commit.e11b9ed9', 'v1.5.7'),
    ).to.deep.equal([
      'v0.8.24+commit.e11b9ed9',
      '0.8.24-1.0.2',
      '0.8.24-1.0.1',
      '0.8.24-1.0.0',
    ]);

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

describe('PreRunCompilation (zksolc)', () => {
  const zkSolcVersion = 'zksolc:1.5.7;solc:0.8.26-1.0.1';

  // Builds a PreRunCompilation the way createPreRunCompilationFromStoredCandidate
  // does for a stored zksolc contract: language is "Solidity" and the version is
  // the combined `zksolc:<v>;solc:<v>` string. zksolc only emits evm.bytecode
  // (EraVM has no deployedBytecode split). The compiler instance is never used
  // since PreRunCompilation does not recompile.
  function createPreRunZkSolcCompilation(
    evmOverrides: Record<string, unknown> = {},
  ) {
    return new PreRunCompilation(
      solc,
      zkSolcVersion,
      makeJsonInput(),
      {
        contracts: {
          [compilationTarget.path]: {
            [compilationTarget.name]: {
              abi: [],
              evm: {
                bytecode: {
                  object: '600102',
                },
                ...evmOverrides,
              },
            },
          },
        },
      } as unknown as SolidityOutput,
      compilationTarget,
      {},
      {},
    );
  }

  it('detects zksolc and uses the ZKSYNC auxdata style', () => {
    const compilation = createPreRunZkSolcCompilation();
    expect(compilation.isZkSolc).to.equal(true);
    expect(compilation.language).to.equal('Solidity');
    expect(compilation.auxdataStyle).to.equal(AuxdataStyle.ZKSYNC);
  });

  it('reads runtime bytecode from evm.bytecode (no deployedBytecode split)', () => {
    const compilation = createPreRunZkSolcCompilation();
    expect(compilation.runtimeBytecode).to.equal('0x600102');
    expect(compilation.creationBytecode).to.equal('0x600102');
  });

  it('reads immutable and link references from evm.bytecode', () => {
    const immutableReferences = { '0': [{ length: 32, start: 3 }] };
    const linkReferences: LinkReferences = {
      'contracts/Lib.sol': { Lib: [{ start: 8, length: 20 }] },
    };
    const compilation = createPreRunZkSolcCompilation({
      bytecode: {
        object: '600102',
        linkReferences,
        immutableReferences,
      },
    });
    expect(compilation.immutableReferences).to.deep.equal(immutableReferences);
    expect(compilation.runtimeLinkReferences).to.deep.equal(linkReferences);
    expect(compilation.creationLinkReferences).to.deep.equal(linkReferences);
  });

  it('falls back to empty references when none are stored', () => {
    const compilation = createPreRunZkSolcCompilation();
    expect(compilation.immutableReferences).to.deep.equal({});
    expect(compilation.runtimeLinkReferences).to.deep.equal({});
  });

  it('reports the zksolc compiler name and combined compiler version', () => {
    const compilation = createPreRunZkSolcCompilation();
    expect(compilation.compilerName).to.equal('zksolc');
    expect(compilation.compilerVersion).to.equal(zkSolcVersion);
  });
});
