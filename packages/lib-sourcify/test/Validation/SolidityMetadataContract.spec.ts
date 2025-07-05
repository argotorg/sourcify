import { expect, use } from 'chai';
import { SolidityMetadataContract } from '../../src/Validation/SolidityMetadataContract';
import { id as keccak256str } from 'ethers';
import nock from 'nock';
import { ISolidityCompiler } from '../../src/Compilation/CompilationTypes';
import { Metadata } from '@ethereum-sourcify/compilers-types';
import { getErrorMessageFromCode, PathContent } from '../../src';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('SolidityMetadataContract', () => {
  let validMetadata: Metadata;
  let validSourceContent: string;
  let validSourcePath: string;
  let validSources: PathContent[];
  let validName: string;

  beforeEach(() => {
    // Setup sample source content and calculate its hash
    validSourcePath = 'contracts/Storage.sol';
    validName = 'Storage';
    validSourceContent = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.0;

      contract Storage {
          uint256 number;

          function store(uint256 num) public {
              number = num;
          }

          function retrieve() public view returns (uint256){
              return number;
          }
      }`;
    const sourceHash = keccak256str(validSourceContent);

    // Create sample metadata
    validMetadata = {
      compiler: {
        version: '0.8.0',
      },
      language: 'Solidity',
      output: {
        abi: [],
        devdoc: {
          kind: 'dev',
          methods: {},
          version: 1,
        },
        userdoc: {
          kind: 'user',
          methods: {},
          version: 1,
        },
      },
      settings: {
        compilationTarget: {
          [validSourcePath]: validName,
        },
        evmVersion: 'london',
        libraries: {},
        metadata: {
          bytecodeHash: 'ipfs',
        },
        optimizer: {
          enabled: false,
          runs: 200,
        },
      },
      sources: {
        [validSourcePath]: {
          keccak256: sourceHash,
          urls: [],
        },
      },
      version: 1,
    };

    validSources = [
      {
        path: validSourcePath,
        content: validSourceContent,
      },
    ];
  });

  describe('constructor', () => {
    it('should correctly initialize all properties with valid metadata and sources', () => {
      const contract = new SolidityMetadataContract(
        validMetadata,
        validSources,
      );

      expect(contract.metadata).to.deep.equal(validMetadata);
      expect(contract.name).to.equal(validName);
      expect(contract.path).to.equal(validSourcePath);
      expect(contract.providedSources).to.deep.equal(validSources);
      expect(contract.providedSourcesByHash).to.be.instanceOf(Map);
      expect(contract.providedSourcesByHash.size).to.equal(1);
      const sourceHash = keccak256str(validSourceContent);
      expect(contract.providedSourcesByHash.get(sourceHash)).to.deep.equal(
        validSources[0],
      );
      expect(contract.foundSources).to.deep.equal({
        [validSourcePath]: validSourceContent,
      });
      expect(Object.keys(contract.missingSources)).to.be.empty;
      expect(Object.keys(contract.invalidSources)).to.be.empty;
      expect(contract.unusedSourceFiles).to.deep.equal([]);
      expect(contract.metadataPathToProvidedFilePath).to.deep.equal({
        [validSourcePath]: validSourcePath,
      });
      expect(contract.compilation).to.be.null;
      expect(contract.solcJsonInput).to.exist;
      expect(contract.solcJsonInput?.language).to.equal('Solidity');
      expect(contract.solcJsonInput?.sources).to.deep.equal({
        [validSourcePath]: {
          content: validSourceContent,
        },
      });
      expect(contract.solcJsonInput?.settings).to.not.have.property(
        'compilationTarget',
      );
      expect(contract.solcJsonInput?.settings.evmVersion).to.equal(
        validMetadata.settings.evmVersion,
      );
      expect(contract.solcJsonInput?.settings.optimizer).to.deep.equal(
        validMetadata.settings.optimizer,
      );
    });

    it('should handle missing sources', () => {
      const contract = new SolidityMetadataContract(validMetadata, []);
      expect(Object.keys(contract.missingSources)).to.have.lengthOf(1);
      expect(contract.missingSources[validSourcePath]).to.exist;
    });

    it('should mark sources with non-matching hashes as missing', () => {
      const invalidContent = 'invalid content';
      const invalidSources = [
        {
          path: validSourcePath,
          content: invalidContent,
        },
      ];
      const contract = new SolidityMetadataContract(
        validMetadata,
        invalidSources,
      );
      expect(Object.keys(contract.missingSources)).to.have.lengthOf(1);
      expect(contract.missingSources[validSourcePath]).to.exist;
      expect(Object.keys(contract.invalidSources)).to.be.empty;
    });

    it('should handle invalid source content in metadata', () => {
      const invalidMetadata = { ...validMetadata };
      const invalidContent = 'invalid content';
      const expectedHash = keccak256str(validSourceContent);
      const calculatedHash = keccak256str(invalidContent);
      invalidMetadata.sources[validSourcePath].content = invalidContent;

      const contract = new SolidityMetadataContract(invalidMetadata, []);
      expect(Object.keys(contract.invalidSources)).to.have.lengthOf(1);
      expect(contract.invalidSources[validSourcePath]).to.exist;
      expect(contract.invalidSources[validSourcePath].msg).to.include(
        "don't match",
      );
      expect(contract.invalidSources[validSourcePath].expectedHash).to.equal(
        expectedHash,
      );
      expect(contract.invalidSources[validSourcePath].calculatedHash).to.equal(
        calculatedHash,
      );
    });
  });

  describe('handleInlinerBug', () => {
    it('should remove inliner setting for affected versions', () => {
      const affectedVersions = ['0.8.2', '0.8.3', '0.8.4'];

      for (const version of affectedVersions) {
        const metadataWithAffectedVersion = { ...validMetadata };
        metadataWithAffectedVersion.compiler.version = version;
        metadataWithAffectedVersion.settings.optimizer = {
          enabled: true,
          runs: 200,
          details: {
            inliner: true,
          },
        };

        const contract = new SolidityMetadataContract(
          metadataWithAffectedVersion,
          validSources,
        );
        contract.createJsonInputFromMetadata();
        expect(contract.solcJsonInput?.settings?.optimizer?.details?.inliner).to
          .be.undefined;
      }
    });

    it('should keep inliner setting for unaffected versions', () => {
      const unaffectedVersions = ['0.8.1', '0.8.5', '0.8.0'];

      for (const version of unaffectedVersions) {
        const metadataWithUnaffectedVersion = { ...validMetadata };
        metadataWithUnaffectedVersion.compiler.version = version;
        metadataWithUnaffectedVersion.settings.optimizer = {
          enabled: true,
          runs: 200,
          details: {
            inliner: true,
          },
        };

        const contract = new SolidityMetadataContract(
          metadataWithUnaffectedVersion,
          validSources,
        );
        contract.createJsonInputFromMetadata();
        expect(contract.solcJsonInput?.settings?.optimizer?.details?.inliner).to
          .be.true;
      }
    });
  });

  describe('compilationTarget', () => {
    it('should handle invalid compilation target', () => {
      const metadata = {
        ...validMetadata,
        settings: {
          ...validMetadata.settings,
          compilationTarget: {
            'contract1.sol': 'Contract1',
            'contract2.sol': 'Contract2',
          },
        },
      };
      expect(
        () => new SolidityMetadataContract(metadata, validSources),
      ).to.throw(
        getErrorMessageFromCode({
          code: 'invalid_compilation_target',
          compilationTargets: ['contract1.sol', 'contract2.sol'],
        }),
      );
    });
  });

  describe('generateSourceVariations', () => {
    it('should generate variations with different line endings', () => {
      const content = 'line1\nline2\r\nline3\rline4';
      const sources = [
        {
          path: validSourcePath,
          content,
        },
      ];

      const contract = new SolidityMetadataContract(validMetadata, sources);
      contract.generateSourceVariations();

      const variations = Array.from(contract.providedSourcesByHash.values());
      expect(variations.length).to.be.greaterThan(1);
      variations.forEach((variation) => {
        expect(variation.path).to.equal(validSourcePath);
      });
    });
  });

  describe('handleLibraries', () => {
    it('should handle pre-0.7.5 library format', () => {
      const metadata = {
        ...validMetadata,
        settings: {
          ...validMetadata.settings,
          libraries: {
            ERC20: '0x1234567890123456789012345678901234567890',
          },
        },
      };
      const contract = new SolidityMetadataContract(metadata, validSources);
      contract.createJsonInputFromMetadata();
      expect(
        contract.solcJsonInput?.settings?.libraries?.[''] as any,
      ).to.deep.equal({
        ERC20: '0x1234567890123456789012345678901234567890',
      });
    });

    it('should handle post-0.7.5 library format', () => {
      const metadata = {
        ...validMetadata,
        settings: {
          ...validMetadata.settings,
          libraries: {
            'contracts/Library.sol:ERC20':
              '0x1234567890123456789012345678901234567890',
          },
        },
      };
      const contract = new SolidityMetadataContract(metadata, validSources);
      contract.createJsonInputFromMetadata();
      expect(
        contract.solcJsonInput?.settings?.libraries?.[
          'contracts/Library.sol'
        ] as any,
      ).to.deep.equal({
        ERC20: '0x1234567890123456789012345678901234567890',
      });
    });

    it('should handle ":" inside library paths correctly', () => {
      const metadata = {
        ...validMetadata,
        settings: {
          ...validMetadata.settings,
          libraries: {
            'contracts/path:with:colons.sol:LibraryName':
              '0x1234567890123456789012345678901234567890',
          },
        },
      };
      const contract = new SolidityMetadataContract(metadata, validSources);
      contract.createJsonInputFromMetadata();
      expect(
        contract.solcJsonInput?.settings?.libraries?.[
          'contracts/path:with:colons.sol'
        ] as any,
      ).to.deep.equal({
        LibraryName: '0x1234567890123456789012345678901234567890',
      });
    });
  });

  describe('createJsonInputFromMetadata', () => {
    it('should throw error when there are missing sources', () => {
      const contract = new SolidityMetadataContract(validMetadata, []);
      expect(() => contract.createJsonInputFromMetadata()).to.throw(
        getErrorMessageFromCode({
          code: 'missing_or_invalid_source',
          missingSources: [validSourcePath],
          invalidSources: [],
        }),
      );
    });

    it('should throw error when there are invalid sources', () => {
      const invalidSources = [
        {
          path: validSourcePath,
          content: 'invalid content',
        },
      ];
      const contract = new SolidityMetadataContract(
        validMetadata,
        invalidSources,
      );
      expect(() => contract.createJsonInputFromMetadata()).to.throw(
        getErrorMessageFromCode({
          code: 'missing_or_invalid_source',
          missingSources: [validSourcePath],
          invalidSources: [],
        }),
      );
    });
  });

  describe('createCompilation', () => {
    afterEach(() => {
      nock.cleanAll();
    });

    it('should create compilation when sources are available', async () => {
      const contract = new SolidityMetadataContract(
        validMetadata,
        validSources,
      );
      const mockCompiler: ISolidityCompiler = {
        compile: async () => ({
          contracts: {},
          sources: {},
          errors: [],
        }),
      };
      const compilation = await contract.createCompilation(mockCompiler);
      expect(compilation).to.exist;
      expect(compilation.compiler).to.equal(mockCompiler);
      expect(compilation.compilerVersion).to.equal(
        validMetadata.compiler.version,
      );
      expect(compilation.compilationTarget).to.deep.equal({
        name: validName,
        path: validSourcePath,
      });
    });

    it('should fetch missing sources before creating compilation', async () => {
      // Create metadata with IPFS source URL
      const ipfsMetadata = { ...validMetadata };
      const ipfsHash = 'QmTest';
      ipfsMetadata.sources[validSourcePath].urls = [`dweb:/ipfs/${ipfsHash}`];

      // Setup mock IPFS response
      nock('https://ipfs.io')
        .get(`/ipfs/${ipfsHash}`)
        .reply(200, validSourceContent);

      const contract = new SolidityMetadataContract(ipfsMetadata, []);
      expect(Object.keys(contract.missingSources)).to.have.lengthOf(1);

      const mockCompiler: ISolidityCompiler = {
        compile: async () => ({
          contracts: {},
          sources: {},
          errors: [],
        }),
      };

      const compilation = await contract.createCompilation(mockCompiler);

      // Verify missing sources were fetched
      expect(Object.keys(contract.missingSources)).to.be.empty;
      expect(contract.foundSources[validSourcePath]).to.equal(
        validSourceContent,
      );

      // Verify compilation was created successfully
      expect(compilation).to.exist;
      expect(compilation.compiler).to.equal(mockCompiler);
      expect(compilation.compilerVersion).to.equal(
        ipfsMetadata.compiler.version,
      );
    });
  });

  describe('fetchMissing', () => {
    afterEach(() => {
      nock.cleanAll();
    });

    it('should fetch missing sources from GitHub', async () => {
      const githubMetadata = { ...validMetadata };
      const githubPath =
        'https://github.com/test/repo/blob/main/contracts/Storage.sol';

      // Use the GitHub URL as the source path in metadata
      githubMetadata.sources = {
        [githubPath]: {
          keccak256: keccak256str(validSourceContent),
          urls: [], // URLs array can be empty since the GitHub path is in the filename
        },
      };

      nock('https://raw.githubusercontent.com')
        .get('/test/repo/main/contracts/Storage.sol')
        .reply(200, validSourceContent);

      const contract = new SolidityMetadataContract(githubMetadata, []);
      expect(Object.keys(contract.missingSources)).to.have.lengthOf(1);

      await contract.fetchMissing();
      expect(Object.keys(contract.missingSources)).to.be.empty;
      expect(contract.foundSources[githubPath]).to.equal(validSourceContent);
    });

    it('should fetch missing sources from IPFS', async () => {
      const ipfsMetadata = { ...validMetadata };
      const ipfsHash = 'QmTest';
      ipfsMetadata.sources[validSourcePath].urls = [`dweb:/ipfs/${ipfsHash}`];

      nock('https://ipfs.io')
        .get(`/ipfs/${ipfsHash}`)
        .reply(200, validSourceContent);

      const contract = new SolidityMetadataContract(ipfsMetadata, []);
      expect(Object.keys(contract.missingSources)).to.have.lengthOf(1);

      await contract.fetchMissing();
      expect(Object.keys(contract.missingSources)).to.be.empty;
      expect(contract.foundSources[validSourcePath]).to.equal(
        validSourceContent,
      );
    });

    it('should throw error when sources cannot be fetched', async () => {
      const contract = new SolidityMetadataContract(validMetadata, []);
      expect(Object.keys(contract.missingSources)).to.have.lengthOf(1);

      nock('https://ipfs.io').get(/.*/).reply(404);

      await expect(contract.fetchMissing()).to.be.eventually.rejectedWith(
        getErrorMessageFromCode({
          code: 'missing_source',
          missingSources: [validSourcePath],
        }),
      );
    });
  });

  describe('assembleContract', () => {
    it('should find sources after generating variations', () => {
      // Create source with different line endings than expected
      const contentWithDifferentEnding = validSourceContent.replace(
        /\n/g,
        '\r\n',
      );
      const sourceHash = keccak256str(validSourceContent); // Hash of the expected content

      // Create metadata that expects the original content hash
      const metadataWithHash = {
        ...validMetadata,
        sources: {
          [validSourcePath]: {
            keccak256: sourceHash,
            urls: [],
          },
        },
      };

      // Provide source with different line endings
      const sourcesWithDifferentEnding = [
        {
          path: validSourcePath,
          content: contentWithDifferentEnding,
        },
      ];

      const contract = new SolidityMetadataContract(
        metadataWithHash,
        sourcesWithDifferentEnding,
      );

      // Initially the source should be missing because the hash doesn't match
      expect(Object.keys(contract.missingSources)).to.be.empty;
      // But after variations are generated, it should be found
      expect(contract.foundSources[validSourcePath]).to.exist;
      expect(contract.metadataPathToProvidedFilePath[validSourcePath]).to.equal(
        validSourcePath,
      );
    });
  });
});
