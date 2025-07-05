import chai, { expect } from "chai";
import chaiHttp from "chai-http";
import config from "config";
import { LocalChainFixture } from "../helpers/LocalChainFixture";
import {
  verifyFromJsonInput,
  verifyFromMetadata,
} from "../../src/server/services/workers/verificationWorker";
import Sinon from "sinon";
import Piscina from "piscina";
import { sourcifyChainsMap } from "../../src/sourcify-chains";
import {
  type SourcifyChainInstance,
  type SoliditySettings,
  SourcifyLibErrorCode,
  OutputError,
} from "@ethereum-sourcify/lib-sourcify";
import { getAddress } from "ethers";
import { VerifyOutput } from "../../src/server/services/workers/workerTypes";
import {
  deployFromAbiAndBytecodeForCreatorTxHash,
  DeploymentInfo,
} from "../helpers/helpers";
import { JobErrorData } from "../../src/server/services/utils/database-util";

chai.use(chaiHttp);

describe("verificationWorker", function () {
  const chainFixture = new LocalChainFixture();
  const piscinaSandbox = Sinon.createSandbox();

  before(() => {
    const sourcifyChainInstanceMap = Object.entries(sourcifyChainsMap).reduce(
      (acc, [chainId, chain]) => {
        acc[chainId] = chain.getSourcifyChainObj();
        return acc;
      },
      {} as Record<string, SourcifyChainInstance>,
    );
    piscinaSandbox.stub(Piscina, "workerData").value({
      sourcifyChainInstanceMap,
      solcRepoPath: config.get("solcRepo"),
      solJsonRepoPath: config.get("solJsonRepo"),
      vyperRepoPath: config.get("vyperRepo"),
    });
  });

  after(() => {
    piscinaSandbox.restore();
  });

  const assertVerificationExport = (result: VerifyOutput) => {
    expect(result).to.not.have.property("errorResponse");
    const contractPath = Object.keys(
      chainFixture.defaultContractMetadataObject.settings.compilationTarget,
    )[0];
    const contractName = Object.values(
      chainFixture.defaultContractMetadataObject.settings.compilationTarget,
    )[0];
    const compilerSettings = {
      ...chainFixture.defaultContractMetadataObject.settings,
    } as unknown as SoliditySettings;
    compilerSettings.outputSelection = {
      "*": {
        "*": [
          "abi",
          "devdoc",
          "userdoc",
          "storageLayout",
          "evm.legacyAssembly",
          "evm.bytecode.object",
          "evm.bytecode.sourceMap",
          "evm.bytecode.linkReferences",
          "evm.bytecode.generatedSources",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.sourceMap",
          "evm.deployedBytecode.linkReferences",
          "evm.deployedBytecode.immutableReferences",
          "metadata",
        ],
      },
    };
    delete (compilerSettings as any).compilationTarget;
    expect(result).to.deep.equal({
      verificationExport: {
        address: chainFixture.defaultContractAddress,
        chainId: parseInt(chainFixture.chainId),
        status: {
          runtimeMatch: "perfect",
          creationMatch: "perfect",
        },
        onchainRuntimeBytecode:
          chainFixture.defaultContractArtifact.deployedBytecode,
        onchainCreationBytecode: chainFixture.defaultContractArtifact.bytecode,
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
        deploymentInfo: {
          blockNumber: chainFixture.defaultContractBlockNumber,
          txIndex: chainFixture.defaultContractTxIndex,
          deployer: getAddress(chainFixture.localSigner.address),
          txHash: chainFixture.defaultContractCreatorTx,
        },
        libraryMap: {
          runtime: {},
          creation: {},
        },
        compilation: {
          language: chainFixture.defaultContractMetadataObject.language,
          compilationTarget: {
            path: contractPath,
            name: contractName,
          },
          compilerVersion:
            chainFixture.defaultContractMetadataObject.compiler.version,
          sources: {
            [Object.keys(
              chainFixture.defaultContractMetadataObject.sources,
            )[0]]: chainFixture.defaultContractSource.toString(),
          },
          compilerOutput: {
            sources: { [contractPath]: { id: 0 } },
          },
          contractCompilerOutput: {
            abi: chainFixture.defaultContractMetadataObject.output.abi,
            userdoc: chainFixture.defaultContractMetadataObject.output.userdoc,
            devdoc: chainFixture.defaultContractMetadataObject.output.devdoc,
            storageLayout: chainFixture.defaultContractArtifact.storageLayout,
            evm: {
              bytecode: {
                sourceMap: chainFixture.defaultContractArtifact.sourceMap,
                linkReferences:
                  chainFixture.defaultContractArtifact.linkReferences,
              },
              deployedBytecode: {
                sourceMap:
                  chainFixture.defaultContractArtifact.deployedSourceMap,
                linkReferences:
                  chainFixture.defaultContractArtifact.deployedLinkReferences,
              },
            },
          },
          runtimeBytecode:
            chainFixture.defaultContractArtifact.deployedBytecode,
          creationBytecode: chainFixture.defaultContractArtifact.bytecode,
          runtimeBytecodeCborAuxdata:
            chainFixture.defaultContractArtifact.deployedCborAuxdata,
          creationBytecodeCborAuxdata:
            chainFixture.defaultContractArtifact.cborAuxdata,
          immutableReferences:
            chainFixture.defaultContractArtifact.immutableReferences,
          metadata: chainFixture.defaultContractMetadataObject,
          jsonInput: {
            settings: compilerSettings,
          },
          // Asserting against itself as we don't know how long the compilation took
          compilationTime:
            result.verificationExport?.compilation?.compilationTime,
        },
      },
    });
  };

  const assertErrorResponse = (
    result: VerifyOutput,
    code: SourcifyLibErrorCode,
    data?: JobErrorData,
  ) => {
    expect(result).to.not.have.property("verificationExport");
    expect(result).to.have.property("errorExport");
    expect(result.errorExport).to.deep.include({
      customCode: code,
      errorData: data,
    });
  };

  describe("verifyFromJsonInput", function () {
    it("should verify a Solidity contract", async () => {
      const compilationTarget = {
        path: Object.keys(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0],
        name: Object.values(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0],
      };
      const result = await verifyFromJsonInput({
        chainId: chainFixture.chainId,
        address: chainFixture.defaultContractAddress,
        jsonInput: chainFixture.defaultContractJsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        compilationTarget,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

      assertVerificationExport(result);
    });

    it("should fetch the creation transaction hash if not provided", async () => {
      const compilationTarget = {
        path: Object.keys(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0],
        name: Object.values(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0],
      };
      const result = await verifyFromJsonInput({
        chainId: chainFixture.chainId,
        address: chainFixture.defaultContractAddress,
        jsonInput: chainFixture.defaultContractJsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        compilationTarget,
      });

      assertVerificationExport(result);
    });

    it("should return an errorResponse if the compiler returns an error", async () => {
      const compilationTarget = {
        path: Object.keys(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0],
        name: Object.values(
          chainFixture.defaultContractMetadataObject.settings.compilationTarget,
        )[0],
      };
      const jsonInput = structuredClone(chainFixture.defaultContractJsonInput);
      // Introduce a syntax error in the source code
      // @ts-ignore
      jsonInput.sources[compilationTarget.path].content = jsonInput.sources[
        compilationTarget.path
      ].content.replace("contract", "contrat");

      const result = await verifyFromJsonInput({
        chainId: chainFixture.chainId,
        address: chainFixture.defaultContractAddress,
        jsonInput,
        compilerVersion:
          chainFixture.defaultContractMetadataObject.compiler.version,
        compilationTarget,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

      assertErrorResponse(result, "compiler_error", {
        compilerErrors: [
          {
            component: "general",
            errorCode: "2314",
            formattedMessage:
              "ParserError: Expected ';' but got '{'\n --> project:/contracts/Storage.sol:9:17:\n  |\n9 | contrat Storage {\n  |                 ^\n\n",
            message: "Expected ';' but got '{'",
            severity: "error",
            sourceLocation: {
              end: 158,
              file: "project:/contracts/Storage.sol",
              start: 157,
            },
            type: "ParserError",
          },
        ] as OutputError[],
        compilerErrorMessage: undefined,
      });
    });
  });

  describe("verifyFromMetadata", function () {
    it("should verify a contract", async () => {
      const sources = {
        [Object.keys(chainFixture.defaultContractMetadataObject.sources)[0]]:
          chainFixture.defaultContractSource.toString(),
      };
      const result = await verifyFromMetadata({
        chainId: chainFixture.chainId,
        address: chainFixture.defaultContractAddress,
        metadata: chainFixture.defaultContractMetadataObject,
        sources,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

      assertVerificationExport(result);
    });

    it("should fetch the creation transaction hash if not provided", async () => {
      const sources = {
        [Object.keys(chainFixture.defaultContractMetadataObject.sources)[0]]:
          chainFixture.defaultContractSource.toString(),
      };
      const result = await verifyFromMetadata({
        chainId: chainFixture.chainId,
        address: chainFixture.defaultContractAddress,
        metadata: chainFixture.defaultContractMetadataObject,
        sources,
      });

      assertVerificationExport(result);
    });

    it("should fetch a missing file from IPFS", async () => {
      const result = await verifyFromMetadata({
        chainId: chainFixture.chainId,
        address: chainFixture.defaultContractAddress,
        metadata: chainFixture.defaultContractMetadataObject,
        sources: {},
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

      assertVerificationExport(result);
    });

    it("should return an errorResponse if the metadata validation fails", async () => {
      // Uses the modified source which doesn't match the hash in metadata
      const sourcePath = Object.keys(
        chainFixture.defaultContractMetadataObject.sources,
      )[0];
      const sources = {
        [sourcePath]: chainFixture.defaultContractModifiedSource.toString(),
      };
      const metadata = structuredClone(
        chainFixture.defaultContractMetadataObject,
      );
      metadata.sources[sourcePath].content =
        chainFixture.defaultContractModifiedSource.toString();

      const result = await verifyFromMetadata({
        chainId: chainFixture.chainId,
        address: chainFixture.defaultContractAddress,
        metadata,
        sources,
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

      assertErrorResponse(result, "missing_or_invalid_source", {
        invalidSources: [sourcePath],
        missingSources: [],
      });
    });

    it("should return an errorResponse if missing sources cannot be fetched", async () => {
      const result = await verifyFromMetadata({
        chainId: chainFixture.chainId,
        address: chainFixture.defaultContractAddress,
        // This metadata includes a modified IPFS hash that cannot be fetched
        metadata: chainFixture.defaultContractMetadataWithModifiedIpfsHash,
        sources: {},
        creationTransactionHash: chainFixture.defaultContractCreatorTx,
      });

      assertErrorResponse(result, "missing_source", {
        missingSources: Object.keys(
          chainFixture.defaultContractMetadataObject.sources,
        ),
      });
    });

    describe("solc v0.6.12 and v0.7.0 extra files in compilation causing metadata match but bytecode mismatch", function () {
      // Deploy the test contract locally
      // Contract from https://explorer.celo.org/address/0x923182024d0Fa5dEe59E3c3db5e2eeD23728D3C3/contracts
      let deploymentInfo: DeploymentInfo;

      before(async () => {
        const bytecodeMismatchArtifact = (
          await import("../sources/artifacts/extraFilesBytecodeMismatch.json")
        ).default;
        deploymentInfo = await deployFromAbiAndBytecodeForCreatorTxHash(
          chainFixture.localSigner,
          bytecodeMismatchArtifact.abi,
          bytecodeMismatchArtifact.bytecode,
        );
      });

      it("should fail if extra-file-input-bug is detected and not all sources are provided", async () => {
        const hardhatOutput = await import(
          "../sources/hardhat-output/extraFilesBytecodeMismatch-onlyMetadata.json"
        );

        const sources = Object.entries(hardhatOutput.input.sources).reduce(
          (acc, [path, source]) => {
            acc[path] = source.content;
            return acc;
          },
          {} as Record<string, string>,
        );
        const metadata = JSON.parse(
          hardhatOutput.output.contracts[
            "contracts/protocol/lendingpool/LendingPool.sol"
          ].LendingPool.metadata,
        );
        const result = await verifyFromMetadata({
          chainId: chainFixture.chainId,
          address: deploymentInfo.contractAddress,
          metadata,
          sources,
          creationTransactionHash: deploymentInfo.txHash,
        });

        assertErrorResponse(result, "extra_file_input_bug");
      });

      it("should verify with all input files if extra-file-input-bug is detected", async () => {
        const hardhatOutput = await import(
          "../sources/hardhat-output/extraFilesBytecodeMismatch.json"
        );

        const sources = Object.entries(hardhatOutput.input.sources).reduce(
          (acc, [path, source]) => {
            acc[path] = source.content;
            return acc;
          },
          {} as Record<string, string>,
        );
        const metadata = JSON.parse(
          hardhatOutput.output.contracts[
            "contracts/protocol/lendingpool/LendingPool.sol"
          ].LendingPool.metadata,
        );
        const result = await verifyFromMetadata({
          chainId: chainFixture.chainId,
          address: deploymentInfo.contractAddress,
          metadata,
          sources,
          creationTransactionHash: deploymentInfo.txHash,
        });

        expect(result).to.not.have.property("errorResponse");
        expect(result).to.have.property("verificationExport");
        expect(result.verificationExport).to.deep.include({
          address: deploymentInfo.contractAddress,
          chainId: parseInt(chainFixture.chainId),
          status: {
            runtimeMatch: "perfect",
            creationMatch: "perfect",
          },
        });
      });
    });
  });
});
