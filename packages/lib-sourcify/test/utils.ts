/* eslint-disable @typescript-eslint/no-var-requires */
import path from 'path';
import { expect } from 'chai';
import { ContractFactory, Signer } from 'ethers';
import {
  useSolidityCompiler,
  useVyperCompiler,
} from '@ethereum-sourcify/compilers';
import {
  SolidityJsonInput,
  SolidityOutput,
  VyperJsonInput,
  VyperOutput,
} from '@ethereum-sourcify/compilers-types';
import { Verification } from '../src/Verification/Verification';
import {
  CompiledContractCborAuxdata,
  ISolidityCompiler,
  IVyperCompiler,
} from '../src/Compilation/CompilationTypes';
/**
 *  Function to deploy contracts from provider unlocked accounts
 *  contractFolderPath must contain an artifact.json file with "abi" and "bytecode" fields
 *
 * @returns the address of the deployed contract and the creator tx hash
 */
// TODO: ABI type definition
export async function deployFromAbiAndBytecode(
  signer: Signer,
  contractFolderPath: string,
  constructorArgs?: any[],
) {
  const artifact = require(path.join(contractFolderPath, 'artifact.json'));
  // Deploy contract
  const contractFactory = new ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer,
  );
  const deployment = await contractFactory.deploy(...(constructorArgs || []));
  await deployment.waitForDeployment();

  const contractAddress = await deployment.getAddress();
  const creationTx = deployment.deploymentTransaction();
  if (!creationTx) {
    throw new Error(
      `No deployment transaction found for ${contractAddress} in contract folder ${contractFolderPath}`,
    );
  }
  return { contractAddress, txHash: creationTx.hash };
}

class Solc implements ISolidityCompiler {
  async compile(
    version: string,
    solcJsonInput: SolidityJsonInput,
    forceEmscripten: boolean = false,
  ): Promise<SolidityOutput> {
    const compilersPath = path.join('/tmp', 'solc-repo');
    const solJsonRepo = path.join('/tmp', 'soljson-repo');
    return await useSolidityCompiler(
      compilersPath,
      solJsonRepo,
      version,
      solcJsonInput,
      forceEmscripten,
    );
  }
}

export const solc = new Solc();

class VyperCompiler implements IVyperCompiler {
  async compile(
    version: string,
    solcJsonInput: VyperJsonInput,
  ): Promise<VyperOutput> {
    return await useVyperCompiler(
      path.join('/tmp', 'vyper-repo'),
      version,
      solcJsonInput,
    );
  }
}

export const vyperCompiler = new VyperCompiler();

/**
 * Helper function to verify a Verification object using its getters
 * @param verification The Verification object to check
 * @param expected Object containing the expected values to verify
 */
export function expectVerification(
  verification: Verification,
  expected: {
    status?: {
      runtimeMatch?: 'perfect' | 'partial' | null;
      creationMatch?: 'perfect' | 'partial' | null;
    };
    libraryMap?: {
      runtime?: { [key: string]: string };
      creation?: { [key: string]: string };
    };
    deploymentInfo?: {
      blockNumber?: number;
      txIndex?: number;
      deployer?: string;
    };
    transformations?: {
      runtime?: {
        list?: any[];
        values?: any;
      };
      creation?: {
        list?: any[];
        values?: any;
      };
    };
    abiEncodedConstructorArguments?: string;
    cborAuxdata?: {
      runtime?: CompiledContractCborAuxdata;
      creation?: CompiledContractCborAuxdata;
    };
  },
) {
  try {
    // Check status
    if (expected.status) {
      if (expected.status.runtimeMatch !== undefined) {
        expect(verification.status.runtimeMatch).to.equal(
          expected.status.runtimeMatch,
        );
      }
      if (expected.status.creationMatch !== undefined) {
        expect(verification.status.creationMatch).to.equal(
          expected.status.creationMatch,
        );
      }
    }

    // Check library map
    if (expected.libraryMap) {
      if (expected.libraryMap.runtime) {
        expect(verification.libraryMap.runtime).to.deep.equal(
          expected.libraryMap.runtime,
        );
      }
      if (expected.libraryMap.creation) {
        expect(verification.libraryMap.creation).to.deep.equal(
          expected.libraryMap.creation,
        );
      }
    }

    // Check deployment info
    if (expected.deploymentInfo) {
      if (expected.deploymentInfo.blockNumber !== undefined) {
        expect(verification.deploymentInfo.blockNumber).to.equal(
          expected.deploymentInfo.blockNumber,
        );
      }
      if (expected.deploymentInfo.txIndex !== undefined) {
        expect(verification.deploymentInfo.txIndex).to.equal(
          expected.deploymentInfo.txIndex,
        );
      }
      if (expected.deploymentInfo.deployer !== undefined) {
        expect(verification.deploymentInfo.deployer).to.equal(
          expected.deploymentInfo.deployer,
        );
      }
    }

    // Check transformations
    if (expected.transformations) {
      if (expected.transformations.runtime) {
        if (expected.transformations.runtime.list) {
          expect(verification.transformations.runtime.list).to.deep.equal(
            expected.transformations.runtime.list,
          );
        }
        if (expected.transformations.runtime.values) {
          expect(verification.transformations.runtime.values).to.deep.equal(
            expected.transformations.runtime.values,
          );
        }
      }
      if (expected.transformations.creation) {
        if (expected.transformations.creation.list) {
          expect(verification.transformations.creation.list).to.deep.equal(
            expected.transformations.creation.list,
          );
        }
        if (expected.transformations.creation.values) {
          expect(verification.transformations.creation.values).to.deep.equal(
            expected.transformations.creation.values,
          );
        }
      }
    }
    if (expected.cborAuxdata) {
      if (expected.cborAuxdata.creation) {
        expect(
          verification.compilation.creationBytecodeCborAuxdata,
        ).to.deep.equal(expected.cborAuxdata.creation);
      }
      if (expected.cborAuxdata.runtime) {
        expect(
          verification.compilation.runtimeBytecodeCborAuxdata,
        ).to.deep.equal(expected.cborAuxdata.runtime);
      }
    }
  } catch (e) {
    console.log('Verification:', verification);
    throw e;
  }
}
