// Shared mock helpers and on-chain bytecode-tail fixtures for the zksolc/EraVM
// unit specs (ZkSolcCompilation.spec.ts and ZkSolcVerification.spec.ts).
import type {
  CompilationTarget,
  IZkSolcCompiler,
} from '../../src/Compilation/CompilationTypes';
import type {
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
} from '@ethereum-sourcify/compilers-types';

export const compilationTarget: CompilationTarget = {
  path: 'contracts/Storage.sol',
  name: 'Storage',
};

export const source = {
  content: 'contract Storage { uint256 value; }',
};

// Real Abstract EraVM bytecode metadata tails, one per era:
// 1.5.15 = CBOR (>=1.5.13), 1.5.7 / 1.3.19 = bare keccak256 hash (<=1.5.12).
export const ABSTRACT_ZKSYNC_1_5_15_TAIL =
  '0x9e2cb40b00000000000000000000000000000000000000000000000000000000d543610e6057093c81336d006b5249a51d6844768d5a0ffcf85636f37df255ac319284ad7d4265c99e51f9e0112e2425b1ad54f8c4e06d7a4191eaa263c72b15000000000000000000000000000000000000000000000000ffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000a264697066735822122007a4f6fdcc0e2b25207322b1a32774e47a4cfef8ba295d46da4f0f0be49859d964736f6c6378247a6b736f6c633a312e352e31353b736f6c633a302e382e32363b6c6c766d3a312e302e320055';
export const ABSTRACT_ZKSYNC_1_5_7_TAIL =
  '0x416273747261637420426164676573000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000d9b67a260000000000000000000000000000000000000020000000000000000000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1ba3b6579b23c9248232fe1a7fb885b70411346f3aad2273798356706e601a5a';
export const ABSTRACT_ZKSYNC_1_3_19_TAIL =
  '0x45524332303a207472616e7366657220616d6f756e7420657863656564732061426c61636b6c69737461626c653a206163636f756e7420697320626c61636b6c426c61636b6c69737461626c653a2063616c6c6572206973206e6f742074686520626c61636b6c69737465720000000000000000000000000000000000000000117e3210bb9aa7d9baff172026820255c6f6c30ba8999d1c2fd88e2848137c4e020000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007e80383289496555d88a2468c5201b230bbc2d259b63f115fafc41dff7e0a304';

export function strip0x(bytecode: string) {
  return bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
}

export function replaceHex(bytecode: string, from: string, to: string) {
  const replaced = bytecode.replace(from, to);
  if (replaced === bytecode) {
    throw new Error(`Could not replace ${from} in bytecode`);
  }
  return replaced;
}

export function makeMetadata(solcVersion: string) {
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

export function makeJsonInput(
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

export function makeContract(
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

export function makeCompiler(
  contract: SolidityOutputContract,
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

// Builds ContractDeployer `create(bytes32 salt, bytes32 bytecodeHash, bytes input)`
// calldata around a versioned bytecode hash and (optionally) ABI-encoded args.
export function makeDeployerCalldata(
  bytecodeHash: string,
  encodedArgs = '',
): string {
  const salt = '00'.repeat(32);
  const hashHex = bytecodeHash.replace(/^0x/, '');
  const offsetHex = (96).toString(16).padStart(64, '0'); // input offset = 0x60
  const lengthHex = (encodedArgs.length / 2).toString(16).padStart(64, '0');
  return `0x9c4d535b${salt}${hashHex}${offsetHex}${lengthHex}${encodedArgs}`;
}
