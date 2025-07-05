import { expect, use } from "chai";
import { sourcifyChainsMap } from "../../../src/sourcify-chains";
import nock from "nock";
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
} from "../../helpers/etherscanResponseMocks";
import {
  fetchFromEtherscan,
  getCompilationFromEtherscanResult,
  getContractPathFromSourcesOrThrow,
  getVyperCompilerVersion,
  processSolidityResultFromEtherscan,
  processVyperResultFromEtherscan,
} from "../../../src/server/services/utils/etherscan-util";
import {
  solc,
  vyperCompiler,
} from "@ethereum-sourcify/lib-sourcify/test/utils";
import chaiAsPromised from "chai-as-promised";
import {
  SolidityCompilation,
  SolidityJsonInput,
  VyperCompilation,
  VyperJsonInput,
} from "@ethereum-sourcify/lib-sourcify";

use(chaiAsPromised);

describe("etherscan util", function () {
  const testChainId = "1";
  const testAddress = "0xB753548F6E010e7e680BA186F9Ca1BdAB2E90cf2";

  this.afterEach(() => {
    nock.cleanAll();
  });

  describe("fetchFromEtherscan", () => {
    it("should throw when fetching a non verified contract from etherscan", async () => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        testAddress,
        UNVERIFIED_CONTRACT_RESPONSE,
      );

      await expect(
        fetchFromEtherscan(
          sourcifyChainsMap[testChainId],
          testAddress,
          undefined,
          true,
        ),
      ).to.eventually.be.rejected.and.have.nested.property(
        "payload.customCode",
        "not_etherscan_verified",
      );
      expect(nockScope.isDone()).to.equal(true);
    });

    it("should throw when an invalid api key is provided", async () => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        testAddress,
        INVALID_API_KEY_RESPONSE,
      );

      await expect(
        fetchFromEtherscan(
          sourcifyChainsMap[testChainId],
          testAddress,
          undefined,
          true,
        ),
      ).to.eventually.be.rejected.and.have.nested.property(
        "payload.customCode",
        "etherscan_request_failed",
      );
      expect(nockScope.isDone()).to.equal(true);
    });

    it("should throw when the rate limit is reached", async () => {
      const nockScope = mockEtherscanApi(
        sourcifyChainsMap[testChainId],
        testAddress,
        RATE_LIMIT_REACHED_RESPONSE,
      );

      await expect(
        fetchFromEtherscan(
          sourcifyChainsMap[testChainId],
          testAddress,
          undefined,
          true,
        ),
      ).to.eventually.be.rejected.and.have.nested.property(
        "payload.customCode",
        "etherscan_limit",
      );
      expect(nockScope.isDone()).to.equal(true);
    });

    [
      ["single contract", SINGLE_CONTRACT_RESPONSE],
      ["multiple contract", MULTIPLE_CONTRACT_RESPONSE],
      ["standard json contract", STANDARD_JSON_CONTRACT_RESPONSE],
      ["vyper single contract", VYPER_SINGLE_CONTRACT_RESPONSE],
      ["vyper standard json contract", VYPER_STANDARD_JSON_CONTRACT_RESPONSE],
    ].forEach(([description, response]) => {
      it(`should return a ${description} response from etherscan`, async () => {
        const nockScope = mockEtherscanApi(
          sourcifyChainsMap[testChainId],
          testAddress,
          response,
        );

        const result = await fetchFromEtherscan(
          sourcifyChainsMap[testChainId],
          testAddress,
        );
        expect(result).to.deep.equal((response as any).result[0]);
        expect(nockScope.isDone()).to.equal(true);
      });
    });
  });

  describe("processSolidityResultFromEtherscan", () => {
    it("should process a single contract response from etherscan", async () => {
      const result = processSolidityResultFromEtherscan(
        SINGLE_CONTRACT_RESPONSE.result[0],
        false,
      );
      expect(result).to.deep.equal({
        compilerVersion:
          SINGLE_CONTRACT_RESPONSE.result[0].CompilerVersion.substring(1),
        jsonInput: {
          language: "Solidity",
          sources: {
            [SINGLE_CONTRACT_RESPONSE.result[0].ContractName + ".sol"]: {
              content: SINGLE_CONTRACT_RESPONSE.result[0].SourceCode,
            },
          },
          settings: {
            optimizer: {
              enabled:
                SINGLE_CONTRACT_RESPONSE.result[0].OptimizationUsed === "1",
              runs: parseInt(SINGLE_CONTRACT_RESPONSE.result[0].Runs),
            },
            outputSelection: {
              "*": {
                "*": ["metadata", "evm.deployedBytecode.object"],
              },
            },
            evmVersion:
              SINGLE_CONTRACT_RESPONSE.result[0].EVMVersion.toLowerCase() !==
              "default"
                ? SINGLE_CONTRACT_RESPONSE.result[0].EVMVersion
                : undefined,
            libraries: {},
          },
        },
        contractName: SINGLE_CONTRACT_RESPONSE.result[0].ContractName,
        contractPath: SINGLE_CONTRACT_RESPONSE.result[0].ContractName + ".sol",
      });
    });

    it("should process a multiple contract response from etherscan", async () => {
      const result = processSolidityResultFromEtherscan(
        MULTIPLE_CONTRACT_RESPONSE.result[0],
        false,
      );
      const expectedSources = JSON.parse(
        MULTIPLE_CONTRACT_RESPONSE.result[0].SourceCode,
      );
      expect(result).to.deep.equal({
        compilerVersion:
          MULTIPLE_CONTRACT_RESPONSE.result[0].CompilerVersion.substring(1),
        jsonInput: {
          language: "Solidity",
          sources: expectedSources,
          settings: {
            optimizer: {
              enabled:
                MULTIPLE_CONTRACT_RESPONSE.result[0].OptimizationUsed === "1",
              runs: parseInt(MULTIPLE_CONTRACT_RESPONSE.result[0].Runs),
            },
            outputSelection: {
              "*": {
                "*": ["metadata", "evm.deployedBytecode.object"],
              },
            },
            evmVersion:
              MULTIPLE_CONTRACT_RESPONSE.result[0].EVMVersion.toLowerCase() !==
              "default"
                ? MULTIPLE_CONTRACT_RESPONSE.result[0].EVMVersion
                : undefined,
            libraries: {},
          },
        },
        contractName: MULTIPLE_CONTRACT_RESPONSE.result[0].ContractName,
        contractPath: getContractPathFromSourcesOrThrow(
          MULTIPLE_CONTRACT_RESPONSE.result[0].ContractName,
          expectedSources,
          false,
        ),
      });
    });

    it("should process a standard json contract response from etherscan", async () => {
      const result = processSolidityResultFromEtherscan(
        STANDARD_JSON_CONTRACT_RESPONSE.result[0],
        false,
      );
      const expectedJsonInput = JSON.parse(
        STANDARD_JSON_CONTRACT_RESPONSE.result[0].SourceCode.substring(
          1,
          STANDARD_JSON_CONTRACT_RESPONSE.result[0].SourceCode.length - 1,
        ),
      );
      expectedJsonInput.settings.outputSelection["*"]["*"] = [
        "metadata",
        "evm.deployedBytecode.object",
      ];
      expect(result).to.deep.equal({
        compilerVersion:
          STANDARD_JSON_CONTRACT_RESPONSE.result[0].CompilerVersion.substring(
            1,
          ),
        jsonInput: expectedJsonInput,
        contractName: STANDARD_JSON_CONTRACT_RESPONSE.result[0].ContractName,
        contractPath: getContractPathFromSourcesOrThrow(
          STANDARD_JSON_CONTRACT_RESPONSE.result[0].ContractName,
          expectedJsonInput.sources,
          false,
        ),
      });
    });
  });

  describe("processVyperResultFromEtherscan", () => {
    it("should process a vyper single contract response from etherscan", async () => {
      const result = await processVyperResultFromEtherscan(
        VYPER_SINGLE_CONTRACT_RESPONSE.result[0],
        false,
      );
      const expectedName =
        VYPER_SINGLE_CONTRACT_RESPONSE.result[0].ContractName.replace(
          /\s+/g,
          "",
        )
          .replace(/\n/g, "")
          .replace(/\r/g, "");
      const expectedPath = `${expectedName}.vy`;
      expect(result).to.deep.equal({
        compilerVersion: await getVyperCompilerVersion(
          VYPER_SINGLE_CONTRACT_RESPONSE.result[0].CompilerVersion,
        ),
        jsonInput: {
          language: "Vyper",
          sources: {
            [expectedPath]: {
              content:
                VYPER_SINGLE_CONTRACT_RESPONSE.result[0].SourceCode.replace(
                  /\r/g,
                  "",
                ),
            },
          },
          settings: {
            outputSelection: {
              "*": ["evm.deployedBytecode.object"],
            },
            evmVersion:
              VYPER_SINGLE_CONTRACT_RESPONSE.result[0].EVMVersion !== "Default"
                ? (VYPER_SINGLE_CONTRACT_RESPONSE.result[0].EVMVersion as any)
                : undefined,
            search_paths: ["."],
          },
        },
        contractName: expectedName,
        contractPath: expectedPath,
      });
    });

    it("should process a vyper standard json contract response from etherscan", async () => {
      const result = await processVyperResultFromEtherscan(
        VYPER_STANDARD_JSON_CONTRACT_RESPONSE.result[0],
        false,
      );
      const expectedJsonInput = JSON.parse(
        VYPER_STANDARD_JSON_CONTRACT_RESPONSE.result[0].SourceCode.substring(
          1,
          VYPER_STANDARD_JSON_CONTRACT_RESPONSE.result[0].SourceCode.length - 1,
        ),
      );
      delete expectedJsonInput.compiler_version;
      delete expectedJsonInput.integrity;
      const expectedPath = Object.keys(
        expectedJsonInput.settings.outputSelection,
      )[0];
      const expectedName = expectedPath.split("/").pop()!.split(".")[0];
      expect(result).to.deep.equal({
        compilerVersion: await getVyperCompilerVersion(
          VYPER_STANDARD_JSON_CONTRACT_RESPONSE.result[0].CompilerVersion,
        ),
        jsonInput: expectedJsonInput,
        contractName: expectedName,
        contractPath: expectedPath,
      });
    });
  });

  describe("getContractPathFromSourcesOrThrow", () => {
    it("should return the correct contract path", () => {
      const sources = {
        // It should not derive it from the path
        "SolidityContract.sol": {
          content: "contract WrongContract {}",
        },
        "path/file.sol": {
          content: "contract WrongContract {}\ncontract SolidityContract {}",
        },
      };

      const result = getContractPathFromSourcesOrThrow(
        "SolidityContract",
        sources,
        true,
      );
      expect(result).to.equal("path/file.sol");
    });

    it("should throw when the contract path is not found in the provided sources", () => {
      const sources = {
        "path/file.sol": {
          content: "contract SolidityContract {}",
        },
      };

      expect(() =>
        getContractPathFromSourcesOrThrow(
          "AnotherSolidityContract",
          sources,
          true,
        ),
      )
        .to.throw()
        .with.property("payload")
        .that.has.property("customCode", "malformed_etherscan_response");
    });
  });

  describe("getCompilationFromEtherscanResult", () => {
    it("should return a SolidityCompilation", async () => {
      const solidityResult = processSolidityResultFromEtherscan(
        SINGLE_CONTRACT_RESPONSE.result[0],
        false,
      );

      const compilation = await getCompilationFromEtherscanResult(
        SINGLE_CONTRACT_RESPONSE.result[0],
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

    it("should return a VyperCompilation", async () => {
      const vyperResult = await processVyperResultFromEtherscan(
        VYPER_SINGLE_CONTRACT_RESPONSE.result[0],
        false,
      );

      const compilation = await getCompilationFromEtherscanResult(
        VYPER_SINGLE_CONTRACT_RESPONSE.result[0],
        solc,
        vyperCompiler,
      );

      const expectedCompilation = new VyperCompilation(
        vyperCompiler,
        vyperResult.compilerVersion,
        vyperResult.jsonInput as VyperJsonInput,
        {
          path: vyperResult.contractPath,
          name: vyperResult.contractName,
        },
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
