import { describe, it, before, after } from 'mocha';
import { expect, use } from 'chai';
import { Verification } from '../../src/Verification/Verification';
import { ChildProcess } from 'child_process';
import { JsonRpcSigner } from 'ethers';
import path from 'path';
import {
  deployFromAbiAndBytecode,
  expectVerification,
  vyperCompiler,
} from '../utils';
import {
  startHardhatNetwork,
  stopHardhatNetwork,
} from '../hardhat-network-helper';
import { SolidityMetadataContract } from '../../src/Validation/SolidityMetadataContract';
import { SolidityOutput } from '@ethereum-sourcify/compilers-types';
import fs from 'fs';
import { VyperCompilation } from '../../src/Compilation/VyperCompilation';
import { PathContent } from '../../src/Validation/ValidationTypes';
import chaiAsPromised from 'chai-as-promised';
import {
  findSolcPlatform,
  useSolidityCompiler,
} from '@ethereum-sourcify/compilers';
import { ISolidityCompiler, SourcifyChain } from '../../src';
import Sinon from 'sinon';

use(chaiAsPromised);

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

// Helper function to get compilation from metadata
async function getCompilationFromMetadata(contractFolderPath: string) {
  // Read metadata.json directly
  const metadataPath = path.join(contractFolderPath, 'metadata.json');
  const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
  const metadata = JSON.parse(metadataRaw);

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

// Helper function to create Vyper compilation
async function createVyperCompilation(
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

const HARDHAT_PORT = 8544;

const UNUSED_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

const hardhatChain = {
  name: 'Hardhat Network Localhost',
  shortName: 'Hardhat Network',
  chainId: 31337,
  faucets: [],
  infoURL: 'localhost',
  nativeCurrency: { name: 'localETH', symbol: 'localETH', decimals: 18 },
  network: 'testnet',
  networkId: 31337,
  rpc: [`http://localhost:${HARDHAT_PORT}`],
  supported: true,
};

const sourcifyChainHardhat: SourcifyChain = new SourcifyChain(hardhatChain);

describe('Verification Class Tests', () => {
  let hardhatNodeProcess: ChildProcess;
  let signer: JsonRpcSigner;
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    hardhatNodeProcess = await startHardhatNetwork(HARDHAT_PORT);
    signer = await sourcifyChainHardhat.providers[0].getSigner();
  });

  beforeEach(() => {
    sandbox = Sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(async () => {
    await stopHardhatNetwork(hardhatNodeProcess);
  });

  describe('Basic Contract Verification', () => {
    it('should verify a simple contract', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Storage',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
      });
    });

    it('should partially verify a simple contract', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Storage',
      );
      const modifiedContractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'StorageModified',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(
        modifiedContractFolderPath,
      );
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'partial',
          creationMatch: null,
        },
      });
    });

    it('should fail to verify a non-existing address', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Storage',
      );
      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        UNUSED_ADDRESS,
      );

      await expect(verification.verify())
        .to.eventually.be.rejectedWith()
        .and.have.property('code', 'contract_not_deployed');
    });

    it('should verify a contract with multiple auxdata with wrong auxdata leading to a partial match', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'WithMultipleAuxdatas',
      );
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        [],
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'partial',
          creationMatch: 'partial',
        },
        transformations: {
          creation: {
            list: [
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 4148,
                id: '1',
              },
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 2775,
                id: '2',
              },
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 4095,
                id: '3',
              },
            ],
            values: {
              cborAuxdata: {
                '1': '0xa2646970667358221220fe338e4778c1623b5865cd4121849802c8ed68e688def4d95b606f2f02ec563e64736f6c63430008090033',
                '2': '0xa2646970667358221220bc654cadfb13b9ef229b6a2db4424f95dc4c52e3ae9b60648aa276f8eb0b3f8464736f6c63430008090033',
                '3': '0xa2646970667358221220eb4312065a8c0fb940ef11ef5853554a447a5325095ee0f8fbbbbfc43dbb1b7464736f6c63430008090033',
              },
            },
          },
        },
      });
    });

    it('should verify a library with call protection and add the transformation', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'CallProtectionForLibraries',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
        transformations: {
          runtime: {
            list: [
              {
                type: 'replace',
                reason: 'callProtection',
                offset: 1,
              },
            ],
            values: {
              callProtection: contractAddress.toLowerCase(),
            },
          },
        },
      });
    });

    it('should fully verify a library with call protection when viaIR is enabled', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'CallProtectionForLibrariesViaIR',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();
      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
      });
    });

    it('should return partial match when there is perfect bytecode match but no auxdata', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'NoAuxdata',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);

      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'partial',
          creationMatch: null,
        },
      });
    });

    it('should throw an error when generateCborAuxdataPositions failed for a contract with cborAuxdata', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Storage',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);

      sandbox
        .stub(compilation, 'generateCborAuxdataPositions')
        .throws(new Error('Cbor auxdata positions could not be generated'));

      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );

      await expect(verification.verify()).to.eventually.be.rejectedWith(
        "The deployed and recompiled bytecode don't match.",
      );
    });

    it('should throw an error when bytecodes dont match and no auxdata to ignore for a partial match', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'NoAuxdata',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);

      Object.defineProperty(compilation, 'runtimeBytecode', {
        get: () =>
          '0x6080604052348015600f57600080fd5b506004361060325760003560e01c80633fa4f24514603757806355241077146051575b600080fd5b603d6069565b604051604891906090565b60405180910390f35b606760048036038101906063919060d5565b606f565b005b60005481565b8060008190555050565b6000819050919050565b608a816079565b82525050565b600060208201905060a360008301846083565b92915050565b600080fd5b60b5816079565b811460bf57600080fd5b50565b60008135905060cf8160ae565b92915050565b60006020828403121560e85760e760a9565b5b600060f48482850160c2565b9150509291505055',
      });

      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );

      await expect(verification.verify())
        .to.eventually.be.rejectedWith()
        .and.have.property('code', 'no_match');
    });

    it('should add constructor transformation with correct offset and arguments', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'WithImmutables',
      );
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        ['12345'],
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: 'perfect',
        },
        transformations: {
          creation: {
            list: [
              {
                type: 'insert',
                reason: 'constructorArguments',
                offset: 970,
              },
            ],
            values: {
              constructorArguments:
                '0x0000000000000000000000000000000000000000000000000000000000003039',
            },
          },
        },
      });
    });

    it('should detect extra file input bug when optimizer is enabled', async () => {
      // Deploy the original contract
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'ExtraFilesBytecodeMismatch',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      // Try to verify with a compilation that has extra files
      const compilation = await getCompilationFromMetadata(contractFolderPath);

      const failingVerification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );

      await expect(failingVerification.verify())
        .to.eventually.be.rejectedWith()
        .and.have.property('code', 'extra_file_input_bug');

      // Read all files from the sources directory
      const sourcesPath = path.join(contractFolderPath, 'complete_sources');
      const sourceFiles: string[] = [];
      const readDirRecursively = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            readDirRecursively(fullPath);
          } else {
            sourceFiles.push(fullPath);
          }
        }
      };
      readDirRecursively(sourcesPath);

      const additionalSources: Record<string, { content: string }> = {};
      for (const fullPath of sourceFiles) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const relativePath = path.relative(sourcesPath, fullPath);
        additionalSources[relativePath] = { content };
      }

      // Use the full sources as the input
      compilation.jsonInput.sources = additionalSources;

      // Try to verify again with the full sources
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
      });
    });

    it('should fail when bytecode could not be fetched', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Storage',
      );
      // Create a chain with invalid RPC to simulate unavailability
      const unavailableChain = new SourcifyChain({
        ...hardhatChain,
        rpc: ['http://localhost:1234'],
      });

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        unavailableChain,
        UNUSED_ADDRESS,
      );

      await expect(verification.verify())
        .to.eventually.be.rejectedWith()
        .and.have.property('code', 'cannot_fetch_bytecode');
    });

    // This test was introduced to test if lib-sourcify can handle multiple equal auxdatas in the creation bytecode
    // The function `findAuxdataPositions` used to fail to assign the proper offset values resulting in a null creation match
    // Read more here: https://github.com/ethereum/sourcify/issues/1980
    // Fixed by PR: https://github.com/ethereum/sourcify/pull/2159
    it('should verify a contract with multiple equal auxdatas', async () => {
      // The files in this directory were modified to cause a partial match (see ./sources/src/PetersMain.sol:1)
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'MultipleEqualAuxdatas',
      );
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        cborAuxdata: {
          creation: {
            '1': {
              offset: 10314,
              value:
                '0xa26469706673582212204417a8927dce438741a0ee03a8a39592a8149d0264b9829ce2a1367eda64155764736f6c63430008110033',
            },
            '2': {
              offset: 21088,
              value:
                '0xa264697066735822122022e52c61b11b7c9141086dac1d81a484ae42bdd45269df5eff2bc04709dbd2ce64736f6c63430008110033',
            },
            '3': {
              offset: 28342,
              value:
                '0xa2646970667358221220900c911a52dbfc724dd2c3f1f6325974708ada8ac1048f422e27bd2eff3312b564736f6c63430008110033',
            },
            '4': {
              offset: 34802,
              value:
                '0xa264697066735822122046cef13e939973f461d6d5184a2f95f92518d099f366ea7e22f7777f92a0c25164736f6c63430008110033',
            },
            '5': {
              offset: 41262,
              value:
                '0xa264697066735822122046cef13e939973f461d6d5184a2f95f92518d099f366ea7e22f7777f92a0c25164736f6c63430008110033',
            },
            '6': {
              offset: 48516,
              value:
                '0xa2646970667358221220900c911a52dbfc724dd2c3f1f6325974708ada8ac1048f422e27bd2eff3312b564736f6c63430008110033',
            },
          },
        },
        status: {
          runtimeMatch: 'partial',
          creationMatch: 'partial',
        },
        transformations: {
          creation: {
            list: [
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 10314,
                id: '1',
              },
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 21088,
                id: '2',
              },
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 28342,
                id: '3',
              },
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 34802,
                id: '4',
              },
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 41262,
                id: '5',
              },
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 48516,
                id: '6',
              },
            ],
            values: {
              cborAuxdata: {
                '1': '0xa2646970667358221220490ef44aec87e88a7eb0c397b57d8dc1e9bf0bb0cfd90606f1e5895ec6b7985664736f6c63430008110033',
                '2': '0xa264697066735822122022e52c61b11b7c9141086dac1d81a484ae42bdd45269df5eff2bc04709dbd2ce64736f6c63430008110033',
                '3': '0xa2646970667358221220900c911a52dbfc724dd2c3f1f6325974708ada8ac1048f422e27bd2eff3312b564736f6c63430008110033',
                '4': '0xa264697066735822122046cef13e939973f461d6d5184a2f95f92518d099f366ea7e22f7777f92a0c25164736f6c63430008110033',
                '5': '0xa264697066735822122046cef13e939973f461d6d5184a2f95f92518d099f366ea7e22f7777f92a0c25164736f6c63430008110033',
                '6': '0xa2646970667358221220900c911a52dbfc724dd2c3f1f6325974708ada8ac1048f422e27bd2eff3312b564736f6c63430008110033',
              },
            },
          },
        },
      });
    });
  });

  describe('Library Contract Verification', () => {
    it('should verify a contract with library placeholders', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'UsingLibrary',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
        libraryMap: {
          runtime: {
            __$da572ae5e60c838574a0f88b27a0543803$__:
              '11fea6722e00ba9f43861a6e4da05fecdf9806b7',
          },
        },
      });
    });
  });

  describe('Immutable Contract Verification', () => {
    it('should verify a contract with immutables', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'WithImmutables',
      );
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        ['12345'],
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: 'perfect',
        },
        transformations: {
          runtime: {
            list: [
              {
                type: 'replace',
                reason: 'immutable',
                offset: 608,
                id: '3',
              },
            ],
            values: {
              immutables: {
                '3': '0x0000000000000000000000000000000000000000000000000000000000003039',
              },
            },
          },
          creation: {
            list: [
              {
                type: 'insert',
                reason: 'constructorArguments',
                offset: 970,
              },
            ],
            values: {
              constructorArguments:
                '0x0000000000000000000000000000000000000000000000000000000000003039',
            },
          },
        },
      });
    });
  });

  describe('Verification Results', () => {
    it('should return correct verification status and bytecodes', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Storage',
      );

      // Deploy the contract
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      // Get compilation using the helper
      const compilation = await getCompilationFromMetadata(contractFolderPath);

      // Create and verify using the Verification class directly
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      // This test just checks that Verification's getter properties return values formatted correctly
      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: 'perfect',
        },
      });

      // Test onchainRuntimeBytecode
      expect(verification.onchainRuntimeBytecode).to.be.a('string');

      // Test onchainCreationBytecode
      expect(verification.onchainCreationBytecode).to.be.a('string');

      // Test getTransformations
      expectVerification(verification, {
        transformations: {
          runtime: {
            list: [],
            values: {},
          },
          creation: {
            list: [],
            values: {},
          },
        },
      });

      // Test getDeploymentInfo
      const deploymentInfo = verification.deploymentInfo;
      expectVerification(verification, {
        deploymentInfo: {
          blockNumber: deploymentInfo.blockNumber,
          txIndex: deploymentInfo.txIndex,
          deployer: deploymentInfo.deployer,
        },
      });

      // Test getLibraryMap
      expectVerification(verification, {
        libraryMap: {
          runtime: {},
          creation: {},
        },
      });
    });
  });

  describe('ViaIR Compilation', () => {
    it('should verify a contract with viaIR:true', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'StorageViaIR',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
      });
    });

    it('should verify a contract with viaIR:true, optimizer disabled, and compiler <0.8.21', async function () {
      const solcPlatform = findSolcPlatform();
      // can't really run this if we can't run a platform-native binary but only Emscripten (solc-js)
      if (!solcPlatform) {
        console.log(
          `skipping test as the running machine can't run a platform-native binary. The platform and architechture is ${process.platform} ${process.arch}`,
        );
        this.skip();
      }

      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'ViaIRUnoptimizedMismatch',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
      });
    });

    // https://github.com/ethereum/sourcify/issues/1159
    it('should verify a contract compiled with nightly solidity', async function () {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Nightly',
      );

      // The artifact has the bytecode from the Emscripten compiler.
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      // Get compilation using the helper
      const compilation = await getCompilationFromMetadata(contractFolderPath);

      // Create and verify using the Verification class directly
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
      });
    });

    it('should verify a contract by finding perfect metadata and recompile the contract with the new sources', async function () {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'ContractWithVariatedSources',
      );

      // The artifact has the bytecode from the Emscripten compiler.
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      // Get compilation using the helper
      const compilation = await getCompilationFromMetadata(contractFolderPath);

      // Create and verify using the Verification class directly
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
      });
    });
  });

  describe('Creation Transaction Verification', () => {
    it('should verify with creation transaction hash', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'WithImmutables',
      );
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        ['12345'],
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: 'perfect',
        },
      });
    });
  });

  describe('Vyper Compilation Tests', () => {
    it('should verify a simple Vyper contract', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Vyper',
        'testcontract',
      );
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const vyperCompilation = await createVyperCompilation(
        contractFolderPath,
        '0.3.10+commit.91361694',
      );

      const verification = new Verification(
        vyperCompilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'partial',
          creationMatch: 'partial',
        },
      });
    });

    it('should verify a Vyper contract with immutables', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Vyper',
        'withImmutables',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        [5], // Constructor argument for immutable value
      );

      const vyperCompilation = await createVyperCompilation(
        contractFolderPath,
        '0.4.0+commit.e9db8d9f',
        {
          evmVersion: 'london',
          optimize: 'codesize',
        },
      );

      const verification = new Verification(
        vyperCompilation,
        sourcifyChainHardhat,
        contractAddress,
      );
      await verification.verify();

      // Check if immutable values are correctly set
      expectVerification(verification, {
        status: {
          runtimeMatch: 'partial',
          creationMatch: null,
        },
        transformations: {
          runtime: {
            list: [
              {
                type: 'insert',
                reason: 'immutable',
                offset: 167,
                id: '0',
              },
            ],
            values: {
              immutables: {
                '0': '0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000eca7a2f8618d6f',
              },
            },
          },
          creation: {
            list: [],
            values: {},
          },
        },
      });
    });

    it('should add constructor transformation with correct offset and arguments for Vyper contract', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Vyper',
        'withImmutables',
      );
      const contractFileName = 'test.vy';
      const vyperContent = await fs.promises.readFile(
        path.join(contractFolderPath, contractFileName),
      );

      const constructorArg = 5;
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        [constructorArg],
      );

      const vyperCompilation = new VyperCompilation(
        vyperCompiler,
        '0.4.0+commit.e9db8d9f',
        {
          language: 'Vyper',
          sources: {
            [contractFileName]: {
              content: vyperContent.toString(),
            },
          },
          settings: {
            evmVersion: 'london',
            optimize: 'codesize',
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

      const verification = new Verification(
        vyperCompilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'partial',
          creationMatch: 'partial',
        },
        transformations: {
          creation: {
            list: [
              {
                type: 'insert',
                reason: 'constructorArguments',
                offset: 245,
              },
            ],
            values: {
              constructorArguments:
                '0x0000000000000000000000000000000000000000000000000000000000000005',
            },
          },
        },
      });
    });

    it('should fail to verify when using wrong Vyper contract', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Vyper',
        'testcontract',
      );
      const wrongContractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Vyper',
        'testcontract2',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
      );

      const vyperCompilation = await createVyperCompilation(
        wrongContractFolderPath,
        '0.3.10+commit.91361694',
      );

      const verification = new Verification(
        vyperCompilation,
        sourcifyChainHardhat,
        contractAddress,
      );

      await expect(verification.verify())
        .to.eventually.be.rejectedWith()
        .and.have.property('code', 'no_match');
    });

    it('should handle Vyper contracts with different auxdata versions', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Vyper',
        'testcontract',
      );
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        path.join(contractFolderPath, 'wrongAuxdata'),
      );

      const vyperCompilation = await createVyperCompilation(
        contractFolderPath,
        '0.3.10+commit.91361694',
      );

      const verification = new Verification(
        vyperCompilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'partial',
          creationMatch: 'partial',
        },
        transformations: {
          creation: {
            list: [
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 158,
                id: '1',
              },
            ],
            values: {
              cborAuxdata: {
                '1': '0x84188f8000a1657679706572830003090012',
              },
            },
          },
        },
      });
    });
  });

  describe('Creation transaction matching tests', () => {
    // https://github.com/ethereum/sourcify/pull/1623
    it('should verify a contract partially with the creation bytecode after transformation fields are normalized', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'Constructor',
      );
      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        ['12345'],
      );

      const modifiedContractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'ConstructorModified',
      );

      const compilation = await getCompilationFromMetadata(
        modifiedContractFolderPath,
      );
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );
      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'partial',
          creationMatch: 'partial',
        },
        transformations: {
          creation: {
            list: [
              {
                type: 'replace',
                reason: 'cborAuxdata',
                offset: 279,
                id: '1',
              },
              {
                type: 'insert',
                reason: 'constructorArguments',
                offset: 332,
              },
            ],
            values: {
              cborAuxdata: {
                '1': '0xa26469706673582212208a693a7ed29129e25fc67a65f83955fb3d86f5fbc378940d697827714b955df564736f6c634300081a0033',
              },
              constructorArguments:
                '0x0000000000000000000000000000000000000000000000000000000000003039',
            },
          },
        },
      });
    });

    it('should return null creationMatch when the wrong creation tx hash is passed', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'WithImmutables',
      );
      const { contractAddress } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        ['12345'],
      );

      // Deploy another contract to get a different transaction hash
      const { txHash: wrongTxHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        ['12345'],
      );

      const compilation = await getCompilationFromMetadata(contractFolderPath);
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        wrongTxHash,
      );

      await verification.verify();

      expectVerification(verification, {
        status: {
          runtimeMatch: 'perfect',
          creationMatch: null,
        },
      });
    });

    it('should fail verification when trying to maliciously verify with creation bytecode that startsWith the creatorTx input', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'WithImmutables',
      );
      const maliciousContractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'WithImmutablesCreationBytecodeAttack',
      );

      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        ['12345'],
      );

      const compilation = await getCompilationFromMetadata(
        maliciousContractFolderPath,
      );
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );

      await expect(verification.verify())
        .to.eventually.be.rejectedWith()
        .and.have.property('code', 'bytecode_length_mismatch');

      expectVerification(verification, {
        status: {
          runtimeMatch: null,
          creationMatch: null,
        },
      });
    });

    it('should fail verification when using an abstract contract', async () => {
      const contractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'WithImmutables',
      );
      const abstractContractFolderPath = path.join(
        __dirname,
        '..',
        'sources',
        'AbstractCreationBytecodeAttack',
      );

      const { contractAddress, txHash } = await deployFromAbiAndBytecode(
        signer,
        contractFolderPath,
        ['12345'],
      );

      const compilation = await getCompilationFromMetadata(
        abstractContractFolderPath,
      );
      const verification = new Verification(
        compilation,
        sourcifyChainHardhat,
        contractAddress,
        txHash,
      );

      await expect(verification.verify())
        .to.eventually.be.rejectedWith()
        .and.have.property('code', 'compiled_bytecode_is_zero');
    });
  });
});
