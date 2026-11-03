import { expect } from "chai";
import {
  getCompilerName,
  getDatabaseColumnsFromVerification,
  normalizeCallProtection,
} from "../../../src/server/services/utils/database-util";

describe("database-util", () => {
  it("stores non-empty Vyper immutable references in runtime code artifacts", async () => {
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

  describe("normalizeCallProtection", () => {
    it("zeroes the address bytes of library bytecode starting with PUSH20", () => {
      const address = "ee".repeat(20);
      const rest = "5f80fd5b50";
      const bytecode = Buffer.from(`73${address}${rest}`, "hex");

      const normalized = normalizeCallProtection(bytecode);

      expect(normalized.toString("hex")).to.equal(
        `73${"00".repeat(20)}${rest}`,
      );
      // The input must not be mutated
      expect(bytecode.toString("hex")).to.equal(`73${address}${rest}`);
    });

    it("returns non-library bytecode unchanged", () => {
      const bytecode = Buffer.from("6080604052348015600e575f80fd", "hex");

      expect(normalizeCallProtection(bytecode)).to.equal(bytecode);
    });
  });

  describe("getCompilerName", () => {
    it("names the compiler from the language and the version", () => {
      expect(getCompilerName("Solidity", "0.8.28+commit.7893614a")).to.equal(
        "solc",
      );
      expect(
        getCompilerName("Solidity", "0.8.38+commit.e7a91fc7.solar.0.3.0"),
      ).to.equal("solar");
      expect(getCompilerName("Yul", "0.8.28+commit.7893614a")).to.equal("solc");
      expect(getCompilerName("Vyper", "0.4.1+commit.8a93dd27")).to.equal(
        "vyper",
      );
      expect(getCompilerName("Fe", "26.0.0-alpha.12")).to.equal("fe");
    });
  });
});
