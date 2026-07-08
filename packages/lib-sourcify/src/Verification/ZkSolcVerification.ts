import { eraBytecodeHash } from '@ethereum-sourcify/bytecode-utils';
import { AbiCoder } from 'ethers';
import { Verification } from './Verification';
import { extractConstructorArgumentsTransformation } from './Transformations';

// ZKsync ContractDeployer functions used to deploy a contract. All of them take
// `(bytes32 salt, bytes32 bytecodeHash, bytes input, ...)`, so the versioned
// bytecode hash always sits at bytes 36..68 of the calldata and the ABI-encoded
// constructor arguments are the `input` parameter.
const CONTRACT_DEPLOYER_SELECTORS: Record<string, readonly string[]> = {
  '0x9c4d535b': ['bytes32', 'bytes32', 'bytes'], // create
  '0x3cda3351': ['bytes32', 'bytes32', 'bytes'], // create2
  '0xecf95b8a': ['bytes32', 'bytes32', 'bytes', 'uint8'], // createAccount
  '0x5d382700': ['bytes32', 'bytes32', 'bytes', 'uint8'], // create2Account
};

const SELECTOR_HEX_LENGTH = 10; // '0x' + 4 bytes
const BYTECODE_HASH_HEX_START = 2 + 8 + 64; // 0x + selector + salt(32)
const BYTECODE_HASH_HEX_END = BYTECODE_HASH_HEX_START + 64; // + bytecodeHash(32)

/**
 * Rewrites on-chain ContractDeployer calldata into the
 * `0x[bytecodeHash][ABI-encoded constructor args]` shape so the canonical
 * creation-matching flow can be reused verbatim: the recompiled "creation
 * bytecode" is the versioned bytecode hash, and the constructor args are the
 * appended tail. Returns null when the calldata is not a recognized
 * ContractDeployer deploy (e.g. a factory/trace-sourced creation).
 */
export function normalizeDeployerCalldata(calldata: string): string | null {
  const raw = calldata.startsWith('0x') ? calldata : `0x${calldata}`;
  const selector = raw.slice(0, SELECTOR_HEX_LENGTH);
  const argTypes = CONTRACT_DEPLOYER_SELECTORS[selector];
  if (!argTypes || raw.length < BYTECODE_HASH_HEX_END) {
    return null;
  }
  const bytecodeHash = raw.slice(
    BYTECODE_HASH_HEX_START,
    BYTECODE_HASH_HEX_END,
  );
  try {
    const decoded = AbiCoder.defaultAbiCoder().decode(
      argTypes,
      `0x${raw.slice(SELECTOR_HEX_LENGTH)}`,
    );
    const constructorArgs = (decoded[2] as string).replace(/^0x/, '');
    return `0x${bytecodeHash}${constructorArgs}`;
  } catch {
    return null;
  }
}

/**
 * EraVM (zksolc) verification. Runtime matching is inherited unchanged — the
 * ZKSYNC auxdata handling is driven by the compilation's `auxdataStyle`, and the
 * solc-specific verification steps in the base class are gated on the compiler so
 * they already skip zksolc.
 *
 * Only creation matching diverges: on EraVM the deploy transaction references a
 * *versioned bytecode hash* of the runtime bytecode (via the ContractDeployer),
 * not the runtime bytecode itself. So the recompiled runtime bytecode is hashed
 * and matched against the hash carried in the creation calldata.
 */
export class ZkSolcVerification extends Verification {
  // Match creation against the normalized `[bytecodeHash][ctor args]` calldata so
  // the shared startsWith + constructor-args logic in matchBytecodes applies. If
  // the calldata isn't a recognized ContractDeployer deploy, fall back to the raw
  // value (which won't start with the versioned hash, so creation won't match).
  protected getOnchainCreationBytecodeForMatching(): string {
    return (
      normalizeDeployerCalldata(this.onchainCreationBytecode) ??
      this.onchainCreationBytecode
    );
  }

  protected async matchWithCreationTx() {
    // The recompiled "creation bytecode" is the versioned hash of the recompiled
    // runtime bytecode — that is exactly what the on-chain ContractDeployer call
    // references.
    const recompiledCreationBytecode = eraBytecodeHash(
      this.compilation.runtimeBytecode,
    );

    const matchBytecodesResult = await this.matchBytecodes(
      true,
      recompiledCreationBytecode,
    );
    if (matchBytecodesResult.match === null) {
      // The recompiled hash isn't the one referenced by the creation calldata →
      // this deploy did not produce our bytecode; leave creationMatch unset.
      return;
    }

    const constructorTransformationResult =
      extractConstructorArgumentsTransformation(
        matchBytecodesResult.populatedRecompiledBytecode,
        this.getOnchainCreationBytecodeForMatching(),
        this.compilation.contractCompilerOutput?.abi || [],
      );

    // EraVM deploys the single runtime artifact by hash, so "creation" is the
    // same bytecode as runtime — the creation match inherits the runtime match
    // type rather than being graded independently (a hash can't be partially
    // matched: it matches iff the recompiled bytecode is byte-identical, i.e. a
    // perfect runtime match).
    this.creationMatch = this.runtimeMatch;
    this.creationTransformations = [
      ...matchBytecodesResult.transformations,
      ...constructorTransformationResult.transformations,
    ];
    this.creationTransformationValues = {
      ...matchBytecodesResult.transformationValues,
      ...constructorTransformationResult.transformationValues,
    };
    this.creationLibraryMap = matchBytecodesResult.libraryMap;
  }
}
