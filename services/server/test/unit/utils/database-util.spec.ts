import { expect } from "chai";
import { getDatabaseColumnsFromVerification } from "../../../src/server/services/utils/database-util";
import type { VerificationExport } from "@ethereum-sourcify/lib-sourcify";

describe("database-util", function () {
  describe("getDatabaseColumnsFromVerification", function () {
    it("should store the zksolc combined compiler version and generic artifacts", async function () {
      const userdoc = { kind: "user", methods: {}, version: 1 };
      const devdoc = { kind: "dev", methods: {}, version: 1 };
      const storageLayout = {
        storage: [
          {
            astId: 1,
            contract: "src/AbstractBadge.sol:AbstractBadge",
            label: "value",
            offset: 0,
            slot: "0",
            type: "t_uint256",
          },
        ],
        types: {
          t_uint256: {
            encoding: "inplace",
            label: "uint256",
            numberOfBytes: "32",
          },
        },
      };
      const linkReferences = {
        "src/Library.sol": {
          Library: [
            {
              start: 8,
              length: 20,
            },
          ],
        },
      };
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
          compilerVersion: "zksolc:1.5.7;solc:0.8.26-1.0.1",
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
            userdoc,
            devdoc,
            storageLayout,
            evm: {
              bytecode: {
                sourceMap: "",
                linkReferences,
              },
              deployedBytecode: {
                sourceMap: "",
                linkReferences,
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
      expect(columns.compiledContract.version).to.equal(
        "zksolc:1.5.7;solc:0.8.26-1.0.1",
      );
      // The zksolc toolchain is stored entirely in `version`; nothing goes into
      // additional_input (no storage_layout_overrides here either).
      expect(columns.compiledContract.additional_input).to.equal(null);
      expect(columns.compiledContract.compilation_artifacts.userdoc).to.equal(
        userdoc,
      );
      expect(columns.compiledContract.compilation_artifacts.devdoc).to.equal(
        devdoc,
      );
      expect(
        columns.compiledContract.compilation_artifacts.storageLayout,
      ).to.equal(storageLayout);
      expect(
        columns.compiledContract.creation_code_artifacts.linkReferences,
      ).to.equal(linkReferences);
      expect(
        columns.compiledContract.runtime_code_artifacts.linkReferences,
      ).to.equal(linkReferences);
    });

    it("stores non-empty Vyper immutable references in runtime code artifacts", async function () {
      const immutableReferences = {
        "0": [{ length: 32, start: 3 }],
      };

      const databaseColumns = await getDatabaseColumnsFromVerification({
        address: "0x0000000000000000000000000000000000000001",
        chainId: 1,
        status: {
          runtimeMatch: "perfect",
          creationMatch: "perfect",
        },
        onchainRuntimeBytecode: "0x600102",
        onchainCreationBytecode: "0x6000600102",
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
          blockNumber: 1,
          txIndex: 0,
          deployer: "0x0000000000000000000000000000000000000002",
          txHash:
            "0x0000000000000000000000000000000000000000000000000000000000000003",
        },
        compilation: {
          language: "Vyper",
          compilerVersion: "0.3.7+commit.6020b8bb",
          creationBytecode: "0x6000600102",
          runtimeBytecode: "0x600102",
          immutableReferences,
          runtimeBytecodeCborAuxdata: {},
          creationBytecodeCborAuxdata: {},
          compilationTarget: {
            path: "test.vy",
            name: "test",
          },
          sources: {
            "test.vy": "# @version 0.3.7\n",
          },
          jsonInput: {
            language: "Vyper",
            sources: {
              "test.vy": {
                content: "# @version 0.3.7\n",
              },
            },
            settings: {
              outputSelection: {
                "*": [],
              },
            },
          },
          compilerOutput: {
            sources: {
              "test.vy": {
                id: 0,
                ast: {},
              },
            },
          },
          contractCompilerOutput: {
            abi: [],
            userdoc: {},
            devdoc: {},
            evm: {
              bytecode: {
                object: "6000600102",
                opcodes: "",
              },
              deployedBytecode: {
                object: "600102",
                opcodes: "",
                sourceMap: "",
              },
            },
          },
        },
      } as any);

      expect(
        databaseColumns.compiledContract.runtime_code_artifacts
          .immutableReferences,
      ).to.deep.equal(immutableReferences);
    });
  });
});
