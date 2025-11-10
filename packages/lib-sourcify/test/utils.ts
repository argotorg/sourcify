/* eslint-disable @typescript-eslint/no-var-requires */
import path from 'path';
import { expect } from 'chai';
import { ContractFactory, JsonRpcSigner, Signer } from 'ethers';
import {
  useSolidityCompiler,
  useVyperCompiler,
} from '@ethereum-sourcify/compilers';
import {
  Metadata,
  SolidityJsonInput,
  SolidityOutput,
  SolidityOutputContract,
  VyperJsonInput,
  VyperOutput,
} from '@ethereum-sourcify/compilers-types';
import { Verification } from '../src/Verification/Verification';
import {
  CompiledContractCborAuxdata,
  ISolidityCompiler,
  IVyperCompiler,
} from '../src/Compilation/CompilationTypes';
import fs from 'fs';
import {
  PathContent,
  SolidityCompilation,
  SolidityMetadataContract,
  VyperCompilation,
} from '../src';

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

class TestSolidityCompiler implements ISolidityCompiler {
  async compile(
    version: string,
    solcJsonInput: any,
    forceEmscripten = false,
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

export function assertCborTransformations(transformations?: any[]) {
  expect(transformations, 'Expected CBOR transformations').to.not.be.undefined;
  if (!transformations) {
    throw new Error('Expected CBOR transformations');
  }

  expect(transformations.length).to.be.greaterThan(0);
  expect(
    transformations.every(
      (transformation) => transformation.reason === 'cborAuxdata',
    ),
  ).to.equal(true);
}

export type MetadataMutator = (metadata: Metadata) => void;

export async function getCompilationFromMetadata(
  contractFolderPath: string,
  metadataMutator?: MetadataMutator,
) {
  // Read metadata.json directly
  const metadataPath = path.join(contractFolderPath, 'metadata.json');
  const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
  const metadata: Metadata = JSON.parse(metadataRaw);

  if (metadataMutator) {
    metadataMutator(metadata);
  }

  // Read source files from the sources directory
  const sourcesPath = path.join(contractFolderPath, 'sources');
  const sources: PathContent[] = [];

  // Recursively read all files from the sources directory
  const readDirRecursively = (dir: string, baseDir: string = '') => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const relativePath = path.join(baseDir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        readDirRecursively(fullPath, relativePath);
      } else {
        const content = fs.readFileSync(fullPath, 'utf8');
        sources.push({
          path: relativePath,
          content,
        });
      }
    }
  };

  readDirRecursively(sourcesPath);

  // Create metadata contract
  const metadataContract = new SolidityMetadataContract(metadata, sources);

  // Create compilation
  return await metadataContract.createCompilation(new TestSolidityCompiler());
}

export async function compileContractWithMetadata(
  contractFolderPath: string,
  metadataMutator?: MetadataMutator,
) {
  const compilation = await getCompilationFromMetadata(
    contractFolderPath,
    metadataMutator,
  );
  await compilation.compile();
  return compilation;
}

export async function deployCompiledContract(
  signer: JsonRpcSigner,
  compilation: SolidityCompilation,
  constructorArgs: unknown[] = [],
) {
  const contractOutput =
    compilation.contractCompilerOutput as SolidityOutputContract;
  const contractFactory = new ContractFactory(
    contractOutput.abi,
    compilation.creationBytecode,
    signer,
  );
  const deployment = await contractFactory.deploy(...constructorArgs);
  await deployment.waitForDeployment();

  const contractAddress = await deployment.getAddress();
  const creationTx = deployment.deploymentTransaction();

  if (!creationTx) {
    throw new Error('Deployment transaction not found.');
  }

  return {
    contractAddress,
    txHash: creationTx.hash,
  };
}

// Helper function to create Vyper compilation
export async function createVyperCompilation(
  contractFolderPath: string,
  version: string,
  settings: {
    evmVersion?: 'london' | 'paris' | 'shanghai' | 'cancun' | 'istanbul';
    optimize?: 'gas' | 'codesize' | 'none' | boolean;
  } = { evmVersion: 'istanbul' },
) {
  const contractFileName = 'test.vy';
  const contractFileContent = await fs.promises.readFile(
    path.join(contractFolderPath, contractFileName),
  );

  return new VyperCompilation(
    vyperCompiler,
    version,
    {
      language: 'Vyper',
      sources: {
        [contractFileName]: {
          content: contractFileContent.toString(),
        },
      },
      settings: {
        ...settings,
        outputSelection: {
          '*': ['evm.bytecode'],
        },
      },
    },
    {
      path: contractFileName,
      name: contractFileName.split('.')[0],
    },
  );
}
