import { expect, use } from 'chai';
import chaiHttp from 'chai-http';
import nock from 'nock';
import chaiAsPromised from 'chai-as-promised';
import {
  SolidityCompilation,
  SolidityJsonInput,
  VyperCompilation,
  VyperJsonInput,
  SourcifyChain,
  EtherscanUtils,
} from '../../src';
import { solc, vyperCompiler } from '../utils';
import {
  INVALID_API_KEY_RESPONSE,
  MULTIPLE_CONTRACT_RESPONSE,
  RATE_LIMIT_REACHED_RESPONSE,
  SINGLE_CONTRACT_RESPONSE,
  STANDARD_JSON_CONTRACT_RESPONSE,
  UNVERIFIED_CONTRACT_RESPONSE,
  VYPER_SINGLE_CONTRACT_RESPONSE,
  VYPER_STANDARD_JSON_CONTRACT_RESPONSE,
  mockEtherscanApi,
} from './etherscanResponseMocks';
import { EtherscanImportError } from '../../src/utils/etherscan/EtherscanTypes';

use(chaiHttp);
use(chaiAsPromised);

function makeChain(chainId: number): SourcifyChain {
  return new SourcifyChain({
    name: 'Test',
    chainId,
    rpc: [],
    supported: false, // avoid provider initialization
    etherscanApi: { supported: true },
  } as any);
}

describe('etherscan util (lib)', function () {
  const testChainId = 1;
  const testAddress = '0xB753548F6E010e7e680BA186F9Ca1BdAB2E90cf2';
  const sourcifyChain = makeChain(testChainId);

  this.afterEach(() => {
    nock.cleanAll();
  });

  describe.only('fetchFromEtherscan', () => {
    it('should throw when fetching a non verified contract from etherscan', async () => {
      const scope = mockEtherscanApi(
        sourcifyChain,
        testAddress,
        UNVERIFIED_CONTRACT_RESPONSE,
        '',
      );

      const error = await expect(
        EtherscanUtils.fetchFromEtherscan(testChainId, testAddress),
      ).to.be.rejectedWith(EtherscanImportError);
      expect((error as any).code).to.equal('etherscan_not_verified');
      expect(scope.isDone()).to.equal(true);
    });

    it('should throw when an invalid api key is provided', async () => {
      const scope = mockEtherscanApi(
        sourcifyChain,
        testAddress,
        INVALID_API_KEY_RESPONSE,
        '',
      );

      const error = await expect(
        EtherscanUtils.fetchFromEtherscan(testChainId, testAddress),
      ).to.be.rejectedWith(EtherscanImportError);
      expect((error as any).code).to.equal('etherscan_api_error');
      expect(scope.isDone()).to.equal(true);
    });

    it('should throw when the rate limit is reached', async () => {
      const scope = mockEtherscanApi(
        sourcifyChain,
        testAddress,
        RATE_LIMIT_REACHED_RESPONSE,
        '',
      );

      const error = await expect(
        EtherscanUtils.fetchFromEtherscan(testChainId, testAddress),
      ).to.be.rejectedWith(EtherscanImportError);
      expect((error as any).code).to.equal('etherscan_rate_limit');
      expect(scope.isDone()).to.equal(true);
    });

    [
      ['single contract', SINGLE_CONTRACT_RESPONSE],
      ['multiple contract', MULTIPLE_CONTRACT_RESPONSE],
      ['standard json contract', STANDARD_JSON_CONTRACT_RESPONSE],
      ['vyper single contract', VYPER_SINGLE_CONTRACT_RESPONSE],
      ['vyper standard json contract', VYPER_STANDARD_JSON_CONTRACT_RESPONSE],
    ].forEach(([description, response]) => {
      it(`should return a ${description} response from etherscan`, async () => {
        const scope = mockEtherscanApi(
          sourcifyChain,
          testAddress,
          response,
          '',
        );
        const result = await EtherscanUtils.fetchFromEtherscan(
          testChainId,
          testAddress,
        );
        expect(result).to.deep.equal((response as any).result[0]);
        expect(scope.isDone()).to.equal(true);
      });
    });
  });

  describe('processSolidityResultFromEtherscan', () => {
    it('should process a single contract response from etherscan', async () => {
      const result = EtherscanUtils.processSolidityResultFromEtherscan(
        SINGLE_CONTRACT_RESPONSE.result[0] as any,
      );
      expect(result).to.deep.equal({
        compilerVersion: (
          SINGLE_CONTRACT_RESPONSE.result[0] as any
        ).CompilerVersion.substring(1),
        jsonInput: {
          language: 'Solidity',
          sources: {
            [(SINGLE_CONTRACT_RESPONSE.result[0] as any).ContractName + '.sol']:
              {
                content: (SINGLE_CONTRACT_RESPONSE.result[0] as any).SourceCode,
              },
          },
          settings: {
            optimizer: {
              enabled:
                (SINGLE_CONTRACT_RESPONSE.result[0] as any).OptimizationUsed ===
                '1',
              runs: parseInt((SINGLE_CONTRACT_RESPONSE.result[0] as any).Runs),
            },
            evmVersion:
              (
                SINGLE_CONTRACT_RESPONSE.result[0] as any
              ).EVMVersion.toLowerCase() !== 'default'
                ? (SINGLE_CONTRACT_RESPONSE.result[0] as any).EVMVersion
                : undefined,
            libraries: {},
          },
        },
        contractName: (SINGLE_CONTRACT_RESPONSE.result[0] as any).ContractName,
        contractPath:
          (SINGLE_CONTRACT_RESPONSE.result[0] as any).ContractName + '.sol',
      });
    });

    it('should process a multiple contract response from etherscan', async () => {
      const result = EtherscanUtils.processSolidityResultFromEtherscan(
        MULTIPLE_CONTRACT_RESPONSE.result[0] as any,
      );
      const expectedSources = JSON.parse(
        (MULTIPLE_CONTRACT_RESPONSE.result[0] as any).SourceCode,
      );
      expect(result).to.deep.equal({
        compilerVersion: (
          MULTIPLE_CONTRACT_RESPONSE.result[0] as any
        ).CompilerVersion.substring(1),
        jsonInput: {
          language: 'Solidity',
          sources: expectedSources,
          settings: {
            optimizer: {
              enabled:
                (MULTIPLE_CONTRACT_RESPONSE.result[0] as any)
                  .OptimizationUsed === '1',
              runs: parseInt(
                (MULTIPLE_CONTRACT_RESPONSE.result[0] as any).Runs,
              ),
            },
            evmVersion:
              (
                MULTIPLE_CONTRACT_RESPONSE.result[0] as any
              ).EVMVersion.toLowerCase() !== 'default'
                ? (MULTIPLE_CONTRACT_RESPONSE.result[0] as any).EVMVersion
                : undefined,
            libraries: {},
          },
        },
        contractName: (MULTIPLE_CONTRACT_RESPONSE.result[0] as any)
          .ContractName,
        contractPath: EtherscanUtils.getContractPathFromSourcesOrThrow(
          (MULTIPLE_CONTRACT_RESPONSE.result[0] as any).ContractName,
          expectedSources,
        ),
      });
    });

    it('should process a standard json contract response from etherscan', async () => {
      const result = EtherscanUtils.processSolidityResultFromEtherscan(
        STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any,
      );
      const expectedJsonInput = JSON.parse(
        (
          (STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any)
            .SourceCode as string
        ).slice(
          1,
          (
            (STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any)
              .SourceCode as string
          ).length - 1,
        ),
      );
      expect(result).to.deep.equal({
        compilerVersion: (
          STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any
        ).CompilerVersion.substring(1),
        jsonInput: expectedJsonInput,
        contractName: (STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any)
          .ContractName,
        contractPath: EtherscanUtils.getContractPathFromSourcesOrThrow(
          (STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any).ContractName,
          expectedJsonInput.sources,
        ),
      });
    });
  });

  describe('processVyperResultFromEtherscan', () => {
    it('should process a vyper single contract response from etherscan', async () => {
      // Mock vyper releases list
      nock('https://vyper-releases-mirror.hardhat.org')
        .get('/list.json')
        .reply(200, [
          {
            tag_name: 'v0.3.10',
            assets: [{ name: 'vyper.0.3.10.darwin' }],
          },
        ]);

      const result = await EtherscanUtils.processVyperResultFromEtherscan(
        VYPER_SINGLE_CONTRACT_RESPONSE.result[0] as any,
      );
      const expectedName = (
        VYPER_SINGLE_CONTRACT_RESPONSE.result[0] as any
      ).ContractName.replace(/\s+/g, '')
        .replace(/\n/g, '')
        .replace(/\r/g, '');
      const expectedPath = `${expectedName}.vy`;
      expect(result).to.deep.equal({
        compilerVersion: await EtherscanUtils.getVyperCompilerVersion(
          (VYPER_SINGLE_CONTRACT_RESPONSE.result[0] as any).CompilerVersion,
        ),
        jsonInput: {
          language: 'Vyper',
          sources: {
            [expectedPath]: {
              content: (
                VYPER_SINGLE_CONTRACT_RESPONSE.result[0] as any
              ).SourceCode.replace(/\r/g, ''),
            },
          },
          settings: {
            outputSelection: { '*': ['evm.deployedBytecode.object'] },
            evmVersion:
              (VYPER_SINGLE_CONTRACT_RESPONSE.result[0] as any).EVMVersion !==
              'Default'
                ? // eslint-disable-next-line indent
                  ((VYPER_SINGLE_CONTRACT_RESPONSE.result[0] as any)
                    .EVMVersion as any)
                : undefined,
            search_paths: ['.'],
          },
        },
        contractName: expectedName,
        contractPath: expectedPath,
      });
    });

    it('should process a vyper standard json contract response from etherscan', async () => {
      // Mock vyper releases list for the version in the fixture
      nock('https://vyper-releases-mirror.hardhat.org')
        .get('/list.json')
        .reply(200, [
          { tag_name: 'v0.4.0', assets: [{ name: 'vyper.0.4.0.darwin' }] },
        ]);

      const result = await EtherscanUtils.processVyperResultFromEtherscan(
        VYPER_STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any,
      );
      const expectedJsonInput = JSON.parse(
        (
          (VYPER_STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any)
            .SourceCode as string
        ).slice(
          1,
          (
            (VYPER_STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any)
              .SourceCode as string
          ).length - 1,
        ),
      );
      delete expectedJsonInput.compiler_version;
      delete expectedJsonInput.integrity;
      const expectedPath = Object.keys(
        expectedJsonInput.settings.outputSelection,
      )[0];
      const expectedName = expectedPath.split('/').pop()!.split('.')[0];
      expect(result).to.deep.equal({
        compilerVersion: await EtherscanUtils.getVyperCompilerVersion(
          (VYPER_STANDARD_JSON_CONTRACT_RESPONSE.result[0] as any)
            .CompilerVersion,
        ),
        jsonInput: expectedJsonInput,
        contractName: expectedName,
        contractPath: expectedPath,
      });
    });
  });

  describe('getContractPathFromSourcesOrThrow', () => {
    it('should throw when the contract path is not found in the provided sources', () => {
      const sources = {
        'path/file.sol': { content: 'contract SolidityContract {}' },
      };
      expect(() =>
        EtherscanUtils.getContractPathFromSourcesOrThrow(
          'AnotherSolidityContract',
          sources,
        ),
      )
        .to.throw(EtherscanImportError)
        .with.property('code', 'etherscan_missing_contract_definition');
    });
  });

  describe('getCompilationFromEtherscanResult', () => {
    it('should return a SolidityCompilation', async () => {
      const solidityResult = EtherscanUtils.processSolidityResultFromEtherscan(
        SINGLE_CONTRACT_RESPONSE.result[0] as any,
      );
      const compilation =
        await EtherscanUtils.getCompilationFromEtherscanResult(
          SINGLE_CONTRACT_RESPONSE.result[0] as any,
          solc,
          vyperCompiler,
        );
      const expectedCompilation = new SolidityCompilation(
        solc,
        solidityResult.compilerVersion,
        solidityResult.jsonInput as SolidityJsonInput,
        {
          path: solidityResult.contractPath,
          name: solidityResult.contractName,
        },
      );
      expect(compilation).to.be.instanceOf(SolidityCompilation);
      expect(compilation.compiler).to.equal(solc);
      expect(compilation.compilerVersion).to.equal(
        expectedCompilation.compilerVersion,
      );
      expect(compilation.jsonInput).to.deep.equal(
        expectedCompilation.jsonInput,
      );
      expect(compilation.compilationTarget).to.deep.equal(
        expectedCompilation.compilationTarget,
      );
    });

    it('should return a VyperCompilation', async () => {
      // Mock vyper releases list
      nock('https://vyper-releases-mirror.hardhat.org')
        .get('/list.json')
        .reply(200, [
          { tag_name: 'v0.3.10', assets: [{ name: 'vyper.0.3.10.darwin' }] },
        ]);

      const vyperResult = await EtherscanUtils.processVyperResultFromEtherscan(
        VYPER_SINGLE_CONTRACT_RESPONSE.result[0] as any,
      );
      const compilation =
        await EtherscanUtils.getCompilationFromEtherscanResult(
          VYPER_SINGLE_CONTRACT_RESPONSE.result[0] as any,
          solc,
          vyperCompiler,
        );
      const expectedCompilation = new VyperCompilation(
        vyperCompiler,
        vyperResult.compilerVersion,
        vyperResult.jsonInput as VyperJsonInput,
        { path: vyperResult.contractPath, name: vyperResult.contractName },
      );
      expect(compilation).to.be.instanceOf(VyperCompilation);
      expect(compilation.compiler).to.equal(vyperCompiler);
      expect(compilation.compilerVersion).to.equal(
        expectedCompilation.compilerVersion,
      );
      expect(compilation.jsonInput).to.deep.equal(
        expectedCompilation.jsonInput,
      );
      expect(compilation.compilationTarget).to.deep.equal(
        expectedCompilation.compilationTarget,
      );
    });
  });
});
