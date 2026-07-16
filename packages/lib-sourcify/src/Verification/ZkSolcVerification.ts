import { eraBytecodeHash as computeEraBytecodeHash } from '@ethereum-sourcify/bytecode-utils';
import { AbiCoder } from 'ethers';
import { Verification } from './Verification';
import { extractConstructorArgumentsTransformation } from './Transformations';

// ZKsync ContractDeployer deploy functions. All take
// `(bytes32 salt, bytes32 bytecodeHash, bytes input, ...)`, so decoding the
// calldata against these types yields the versioned bytecode hash (index 1) and
// the ABI-encoded constructor arguments (`input`, index 2) directly.
const CONTRACT_DEPLOYER_SELECTORS: Record<string, readonly string[]> = {
  '0x9c4d535b': ['bytes32', 'bytes32', 'bytes'], // create
  '0x3cda3351': ['bytes32', 'bytes32', 'bytes'], // create2
  '0xecf95b8a': ['bytes32', 'bytes32', 'bytes', 'uint8'], // createAccount
  '0x5d382700': ['bytes32', 'bytes32', 'bytes', 'uint8'], // create2Account
};

const SELECTOR_HEX_LENGTH = 10; // '0x' + 4 bytes

// ZKsync ContractDeployer system contract
const SYSTEM_CONTRACT_DEPLOYER_ADDRESS =
  '0x0000000000000000000000000000000000008006';

export interface ContractDeployerDeploy {
  bytecodeHash: string;
  constructorArguments: string;
}

/**
 * Decodes ZKsync ContractDeployer deploy calldata into its structured fields.
 * The deploy functions share the `(bytes32 salt, bytes32 bytecodeHash, bytes
 * input, ...)` shape, so a single ABI decode gives the versioned bytecode hash
 * and the constructor arguments (the `input` param) — no positional slicing.
 * Returns null when the calldata is not a recognized ContractDeployer deploy
 * (unknown selector) or fails to decode.
 */
export function decodeContractDeployerCalldata(
  calldata: string,
): ContractDeployerDeploy | null {
  const raw = calldata.startsWith('0x') ? calldata : `0x${calldata}`;
  const selector = raw.slice(0, SELECTOR_HEX_LENGTH);
  const argTypes = CONTRACT_DEPLOYER_SELECTORS[selector];
  if (!argTypes) {
    return null;
  }
  try {
    const decoded = AbiCoder.defaultAbiCoder().decode(
      argTypes,
      `0x${raw.slice(SELECTOR_HEX_LENGTH)}`,
    );
    return {
      bytecodeHash: decoded[1] as string,
      constructorArguments: decoded[2] as string,
    };
  } catch {
    return null;
  }
}

/**
 * EraVM (zksolc) verification. Runtime matching is inherited unchanged
 *
 * Only creation matching diverges: on EraVM the deploy transaction calls the
 * ContractDeployer directly, and the deploy calldata carries a versioned *hash*
 * of the runtime bytecode, not the bytecode itself. So the match is a structural
 * check of the calldata: decode it and compare its bytecode-hash field against
 * the hash of the recompiled runtime bytecode.
 */
export class ZkSolcVerification extends Verification {
  protected async matchWithCreationTx() {
    // Only a direct deploy carries the ContractDeployer calldata as the creation
    // tx's top-level input. Anything else (factory / indirect deploy) is not a
    // structure we can match here.
    if (this.creationTxTo?.toLowerCase() !== SYSTEM_CONTRACT_DEPLOYER_ADDRESS) {
      return;
    }

    const deploy = decodeContractDeployerCalldata(this.onchainCreationBytecode);
    if (deploy === null) {
      return;
    }

    // The versioned hash of the recompiled runtime bytecode must equal the hash
    // the deploy calldata references. This is an equality check on a field, not
    // a bytecode comparison — EraVM has no on-chain creation bytecode.
    const eraBytecodeHash = computeEraBytecodeHash(
      this.compilation.runtimeBytecode,
    );
    if (deploy.bytecodeHash.toLowerCase() !== eraBytecodeHash.toLowerCase()) {
      return;
    }

    // Reuse the canonical constructor-args extraction (which also validates the
    // args round-trip through the ABI) by presenting the decoded `input` as the
    // tail after the hash prefix.
    const constructorTransformationResult =
      extractConstructorArgumentsTransformation(
        eraBytecodeHash,
        `${eraBytecodeHash}${deploy.constructorArguments.replace(/^0x/, '')}`,
        this.compilation.contractCompilerOutput?.abi || [],
      );

    // EraVM deploys the single runtime artifact by hash, so "creation" is the
    // same bytecode as runtime — the creation match inherits the runtime match
    // type rather than being graded independently (a hash can't be partially
    // matched: it matches iff the recompiled bytecode is byte-identical, i.e. a
    // perfect runtime match).
    this.creationMatch = this.runtimeMatch;
    this.creationTransformations = [
      ...constructorTransformationResult.transformations,
    ];
    this.creationTransformationValues = {
      ...constructorTransformationResult.transformationValues,
    };
  }
}
