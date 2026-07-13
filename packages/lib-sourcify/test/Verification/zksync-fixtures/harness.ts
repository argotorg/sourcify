import fs from 'fs';
import path from 'path';
import { getAddress } from 'ethers';
import { SourcifyChain } from '../../../src';
import { ZkSolcCompilation } from '../../../src/Compilation/ZkSolcCompilation';
import { ZkSolcVerification } from '../../../src/Verification/ZkSolcVerification';
import type { VerificationStatus } from '../../../src/Verification/VerificationTypes';
import type { SolidityJsonInput } from '@ethereum-sourcify/compilers-types';
import { zksolc } from '../../utils';

export const FIXTURES_DIR = __dirname;

// Abstract mainnet — a native ZKsync-stack (EraVM) chain. The e2e tests read
// on-chain bytecode / creation txs from its public RPC; they never call the
// block explorer (the sources are committed as fixtures).
export const ABSTRACT_CHAIN_ID = 2741;
export const ABSTRACT_RPC = 'https://api.mainnet.abs.xyz';

export const abstractChain = new SourcifyChain({
  name: 'Abstract',
  shortName: 'Abstract',
  chainId: ABSTRACT_CHAIN_ID,
  faucets: [],
  infoURL: 'https://abs.xyz',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  network: 'mainnet',
  networkId: ABSTRACT_CHAIN_ID,
  rpcs: [{ rpc: ABSTRACT_RPC }],
  supported: true,
});

export interface ZkSyncFixtureExpected {
  chainId: number;
  address: string;
  contractName: string;
  contractPath: string;
  creationTransactionHash: string | null;
  explorerZkSolcVersion: string; // e.g. "v1.5.15"
  explorerSolcVersion: string; // e.g. "v0.8.24+commit…" or "0.8.24-1.0.2"
  constructorArguments: string;
  hasLibraries: boolean;
  directDeploy: boolean;
  creationMatchable: boolean;
  onchainRuntimeByteLength: number;
  // The full "zksolc:<v>;solc:<v>" composite that matches on-chain, and the
  // match statuses it produces:
  compilerVersion: string | null;
  expectedRuntimeMatch: VerificationStatus;
  expectedCreationMatch: VerificationStatus;
  notes: string;
}

export interface ZkSyncFixture {
  label: string;
  input: SolidityJsonInput;
  expected: ZkSyncFixtureExpected;
}

export function listFixtureLabels(): string[] {
  return fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        fs.existsSync(path.join(FIXTURES_DIR, e.name, 'input.json')) &&
        fs.existsSync(path.join(FIXTURES_DIR, e.name, 'expected.json')),
    )
    .map((e) => e.name)
    .sort();
}

export function loadFixture(label: string): ZkSyncFixture {
  const dir = path.join(FIXTURES_DIR, label);
  const input = JSON.parse(
    fs.readFileSync(path.join(dir, 'input.json'), 'utf8'),
  );
  const expected = JSON.parse(
    fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'),
  );
  return { label, input, expected };
}

// Compile with the fixture's (full) composite version and verify against the
// live Abstract RPC. verify() throws on no_match / compiler errors.
export async function verifyFixture(
  expected: ZkSyncFixtureExpected,
  input: SolidityJsonInput,
  compilerVersion: string,
): Promise<ZkSolcVerification> {
  const compilation = new ZkSolcCompilation(zksolc, compilerVersion, input, {
    path: expected.contractPath,
    name: expected.contractName,
  });
  const verification = new ZkSolcVerification(
    compilation,
    abstractChain,
    // Checksum the address: getContractCreationBytecodeAndReceipt compares the
    // receipt's (checksummed) contractAddress case-sensitively.
    getAddress(expected.address),
    expected.creationTransactionHash ?? undefined,
  );
  await verification.verify();
  return verification;
}
