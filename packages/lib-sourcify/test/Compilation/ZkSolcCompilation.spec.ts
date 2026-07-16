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
import { Verification } from '../../src/Verification/Verification';
import {
  ZkSolcVerification,
  decodeContractDeployerCalldata,
} from '../../src/Verification/ZkSolcVerification';
import { PreRunCompilation } from '../../src/Compilation/PreRunCompilation';
import {
  CompilationError,
  type CompilationTarget,
  type IZkSolcCompiler,
} from '../../src/Compilation/CompilationTypes';
import { solc } from '../utils';
import type {
  LinkReferences,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
} from '@ethereum-sourcify/compilers-types';
import {
  AuxdataStyle,
  eraBytecodeHash,
} from '@ethereum-sourcify/bytecode-utils';

use(chaiAsPromised);

const compilationTarget: CompilationTarget = {
  path: 'contracts/Storage.sol',
  name: 'Storage',
};

const source = {
  content: 'contract Storage { uint256 value; }',
};

const ABSTRACT_ZKSYNC_1_5_15_TAIL =
  '0x9e2cb40b00000000000000000000000000000000000000000000000000000000d543610e6057093c81336d006b5249a51d6844768d5a0ffcf85636f37df255ac319284ad7d4265c99e51f9e0112e2425b1ad54f8c4e06d7a4191eaa263c72b15000000000000000000000000000000000000000000000000ffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000a264697066735822122007a4f6fdcc0e2b25207322b1a32774e47a4cfef8ba295d46da4f0f0be49859d964736f6c6378247a6b736f6c633a312e352e31353b736f6c633a302e382e32363b6c6c766d3a312e302e320055';
const ABSTRACT_ZKSYNC_1_5_7_TAIL =
  '0x416273747261637420426164676573000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000d9b67a260000000000000000000000000000000000000020000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1ba3b6579b23c9248232fe1a7fb885b70411346f3aad2273798356706e601a5a';
const ABSTRACT_ZKSYNC_1_3_19_TAIL =
  '0x45524332303a207472616e7366657220616d6f756e7420657863656564732061426c61636b6c69737461626c653a206163636f756e7420697320626c61636b6c426c61636b6c69737461626c653a2063616c6c6572206973206e6f742074686520626c61636b6c69737465720000000000000000000000000000000000000000117e3210bb9aa7d9baff172026820255c6f6c30ba8999d1c2fd88e2848137c4e020000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007e80383289496555d88a2468c5201b230bbc2d259b63f115fafc41dff7e0a304';

function strip0x(bytecode: string) {
  return bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
}

function replaceHex(bytecode: string, from: string, to: string) {
  const replaced = bytecode.replace(from, to);
  if (replaced === bytecode) {
    throw new Error(`Could not replace ${from} in bytecode`);
  }
  return replaced;
}

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

// ZkSolcCompilation now takes the single combined `zksolc:<v>;solc:<v>` string.
// This helper keeps the tests expressed in terms of the two versions.
function makeZkSolcCompilation(
  compiler: IZkSolcCompiler,
  zksolcVersion: string,
  solcCompilerVersion: string,
  jsonInput: SolidityJsonInput,
  target: CompilationTarget,
): ZkSolcCompilation {
  return new ZkSolcCompilation(
    compiler,
    formatZkSolcCompilerVersion(zksolcVersion, solcCompilerVersion),
    jsonInput,
    target,
  );
}

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

  it('keeps compilerVersion as the plain zksolc semver but exports the combined string', () => {
    const compilation = makeZkSolcCompilation(
      makeCompiler(makeContract()),
      '1.5.16',
      '0.8.26-1.0.2',
      makeJsonInput(),
      compilationTarget,
    );
    // The inherited compilerVersion stays a plain semver (the Solidity
    // heuristics in Verification parse it), while the resolved/exported value is
    // the combined toolchain string stored in the DB.
    expect(compilation.compilerVersion).to.equal('1.5.16');
    expect(compilation.resolvedCompilerVersion).to.equal(
      'zksolc:1.5.16;solc:0.8.26-1.0.2',
    );
    expect(compilation.compilerName).to.equal('zksolc');
  });

  it('should compile with zksolc and solc versions', async () => {
    const solcVersion = '0.8.24-1.0.1';
    const compiler = makeCompiler(
      makeContract({
        metadata: makeMetadata(solcVersion),
      }),
    );
    const compilation = makeZkSolcCompilation(
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
    expect(compilation.auxdataStyle).to.equal(AuxdataStyle.ZKSYNC);
    expect(compilation.compilerName).to.equal('zksolc');
    expect(compilation.resolvedCompilerVersion).to.equal(
      `zksolc:v1.5.3;solc:${solcVersion}`,
    );
    expect(compilation.solcCompilerVersion).to.equal(solcVersion);
  });

  it('should preserve non-semver zksolc versions for the compiler', async () => {
    const compiler = makeCompiler(makeContract());
    const compilation = makeZkSolcCompilation(
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

  it('should compile with the exact upstream solc release string passed', async () => {
    const solcVersion = 'v0.8.26+commit.8a97fa7a';
    const compiler = makeCompiler(
      makeContract({
        metadata: makeMetadata(solcVersion),
      }),
    );
    const compilation = makeZkSolcCompilation(
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

  it('should accept object metadata from zksolc output', async () => {
    const metadata = JSON.parse(makeMetadata('0.8.26-1.0.2'));
    const compiler = makeCompiler(
      makeContract({
        metadata,
      } as any),
    );
    const compilation = makeZkSolcCompilation(
      compiler,
      '1.5.7',
      '0.8.26-1.0.2',
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
      const compilation = makeZkSolcCompilation(
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
    const compilation = makeZkSolcCompilation(
      compiler,
      '1.3.5',
      '0.6.12-1.0.1',
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
    const compilation = makeZkSolcCompilation(
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
    const compilation = makeZkSolcCompilation(
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
    const compilation = makeZkSolcCompilation(
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
    const compilation = makeZkSolcCompilation(
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
    const compilation = makeZkSolcCompilation(
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
    const compilation = makeZkSolcCompilation(
      compiler,
      '1.5.15',
      '0.8.26-1.0.2',
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
    const compilation = makeZkSolcCompilation(
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
    const compilation = makeZkSolcCompilation(
      compiler,
      '1.5.15',
      '0.8.26-1.0.2',
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
    it(`should verify PR-body Abstract EraVM bytecode sample ${sample.address}`, async () => {
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
      const compilation = makeZkSolcCompilation(
        compiler,
        sample.zksolcVersion,
        sample.solcVersion,
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
    const compilation = makeZkSolcCompilation(
      compiler,
      '1.3.19',
      'v0.6.12+commit.27d51765',
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
    const compilation = makeZkSolcCompilation(
      compiler,
      '1.5.7',
      '0.8.26-1.0.1',
      jsonInput,
      compilationTarget,
    );

    await compilation.compile();
    await compilation.generateCborAuxdataPositions();

    expect(compilation.runtimeBytecodeCborAuxdata).to.deep.equal({});
  });

  it('should partially match zkSync EraVM bytecode when only CBOR metadata differs', async () => {
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
    const compilation = makeZkSolcCompilation(
      compiler,
      '1.5.15',
      '0.8.26-1.0.2',
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

  it('should partially match zkSync EraVM bytecode when only bare metadata hash differs', async () => {
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
    const compilation = makeZkSolcCompilation(
      compiler,
      '1.3.19',
      'v0.6.12+commit.27d51765',
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

  it('should throw when the compilation target is missing', async () => {
    const compiler: IZkSolcCompiler = {
      async compile(): Promise<SolidityOutput> {
        return {
          contracts: {},
        };
      },
    };
    const compilation = makeZkSolcCompilation(
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

  it('reports the zksolc compiler name and combined export version', () => {
    const compilation = createPreRunZkSolcCompilation();
    expect(compilation.compilerName).to.equal('zksolc');
    expect(compilation.resolvedCompilerVersion).to.equal(zkSolcVersion);
  });
});

// Builds ContractDeployer `create(bytes32 salt, bytes32 bytecodeHash, bytes input)`
// calldata around a versioned bytecode hash and (optionally) ABI-encoded args.
function makeDeployerCalldata(bytecodeHash: string, encodedArgs = ''): string {
  const salt = '00'.repeat(32);
  const hashHex = bytecodeHash.replace(/^0x/, '');
  const offsetHex = (96).toString(16).padStart(64, '0'); // input offset = 0x60
  const lengthHex = (encodedArgs.length / 2).toString(16).padStart(64, '0');
  return `0x9c4d535b${salt}${hashHex}${offsetHex}${lengthHex}${encodedArgs}`;
}

describe('ZkSolcVerification', () => {
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
    return makeZkSolcCompilation(
      compiler,
      '1.5.7',
      '0.8.26-1.0.1',
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
