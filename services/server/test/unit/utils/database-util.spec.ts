import { expect } from "chai";
import { getDatabaseColumnsFromVerification } from "../../../src/server/services/utils/database-util";
import type { VerificationExport } from "@ethereum-sourcify/lib-sourcify";

describe("database-util", function () {
  describe("getDatabaseColumnsFromVerification", function () {
    it("should store zksolc compiler identity and era-solc version", async function () {
      const verification = {
        address: "0xbc176Ac2373614F9858A118917d83b139bcb3f8c",
        chainId: 2741,
        status: {
          runtimeMatch: "partial",
          creationMatch: null,
        },
        onchainRuntimeBytecode: "0x010203",
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
        deploymentInfo: {},
        libraryMap: {},
        compilation: {
          language: "Solidity",
          compiler: "zksolc",
          compilerVersion: "1.5.7",
          zksolc: {
            solcCompilerVersion: "0.8.26-1.0.1",
          },
          compilationTarget: {
            path: "src/AbstractBadge.sol",
            name: "AbstractBadge",
          },
          sources: {
            "src/AbstractBadge.sol": "contract AbstractBadge {}",
          },
          compilerOutput: {
            sources: {},
          },
          contractCompilerOutput: {
            abi: [],
            evm: {
              bytecode: {
                sourceMap: "",
                linkReferences: {},
              },
              deployedBytecode: {
                sourceMap: "",
                linkReferences: {},
              },
            },
          },
          runtimeBytecode: "0x010203",
          creationBytecode: "0x010203",
          runtimeBytecodeCborAuxdata: {},
          creationBytecodeCborAuxdata: {},
          immutableReferences: {},
          jsonInput: {
            settings: {},
          },
        },
      } as unknown as VerificationExport;

      const columns = await getDatabaseColumnsFromVerification(verification);

      expect(columns.compiledContract.compiler).to.equal("zksolc");
      expect(columns.compiledContract.version).to.equal("1.5.7");
      expect(columns.compiledContract.additional_input).to.deep.equal({
        era_solc_version: "0.8.26-1.0.1",
      });
    });
  });
});
