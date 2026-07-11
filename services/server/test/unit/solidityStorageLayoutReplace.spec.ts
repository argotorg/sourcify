import { expect } from "chai";
import sinon from "sinon";
import { replaceSolidityStorageLayout } from "../../src/server/apiv1/verification/private/stateless/solidityStorageLayoutReplace";

const storageLayout = {
  storage: [
    {
      astId: 1,
      contract: "Fixture.sol:Fixture",
      label: "owner",
      offset: 0,
      slot: "0",
      type: "t_address",
    },
  ],
  types: {
    t_address: {
      encoding: "inplace",
      label: "address",
      numberOfBytes: "20",
    },
  },
};

function verification(options?: {
  language?: string;
  version?: string;
  runtimeMatch?: "perfect" | "partial" | null;
  layout?: unknown;
}) {
  return {
    address: "0x0000000000000000000000000000000000000001",
    chainId: 1,
    status: {
      runtimeMatch:
        options && "runtimeMatch" in options ? options.runtimeMatch : "perfect",
      creationMatch: null,
    },
    compilation: {
      language: options?.language ?? "Solidity",
      compilerVersion: options?.version ?? "0.5.12+commit.7709ece9",
      compilationTarget: { path: "Fixture.sol", name: "Fixture" },
      sources: { "Fixture.sol": "contract Fixture { address owner; }\n" },
      jsonInput: {
        settings: {
          evmVersion: "petersburg",
          outputSelection: { "*": { "*": ["storageLayout"] } },
        },
      },
      contractCompilerOutput: {
        storageLayout:
          options && "layout" in options ? options.layout : storageLayout,
      },
    },
  } as any;
}

describe("replaceSolidityStorageLayout", () => {
  it("rejects non-Solidity compilations", async () => {
    const query = sinon.stub();

    await expectFailure(
      replaceSolidityStorageLayout(
        { database: { pool: { query } } } as any,
        verification({ language: "Vyper" }),
      ),
      "only supports Solidity contracts",
    );
    expect(query.called).to.equal(false);
  });

  for (const version of [
    "0.3.6+commit.3fc68da5",
    "0.4.6+commit.2dabbdf0",
    "0.5.13+commit.5b0b510c",
  ]) {
    it(`rejects compiler version ${version}`, async () => {
      const query = sinon.stub();

      await expectFailure(
        replaceSolidityStorageLayout(
          { database: { pool: { query } } } as any,
          verification({ version }),
        ),
        "versions from 0.4.7 through 0.5.12",
      );
      expect(query.called).to.equal(false);
    });
  }

  it("rejects a layout from a compilation that did not match", async () => {
    const query = sinon.stub();

    await expectFailure(
      replaceSolidityStorageLayout(
        { database: { pool: { query } } } as any,
        verification({ runtimeMatch: null }),
      ),
      "did not match the deployment",
    );
    expect(query.called).to.equal(false);
  });

  it("leaves the row untouched when recovery returned no layout", async () => {
    const query = sinon.stub();

    const result = await replaceSolidityStorageLayout(
      { database: { pool: { query } } } as any,
      verification({ layout: undefined }),
    );

    expect(result).to.deep.equal({
      reason: "Historical Solidity storage layout could not be recovered",
      replaced: false,
    });
    expect(query.called).to.equal(false);
  });

  it("rejects a malformed recovered layout", async () => {
    const query = sinon.stub();

    await expectFailure(
      replaceSolidityStorageLayout(
        { database: { pool: { query } } } as any,
        verification({ layout: {} }),
      ),
      "invalid structure",
    );
    expect(query.called).to.equal(false);
  });

  it("writes only a missing layout for an exact compilation identity", async () => {
    const query = sinon.stub();
    query.onFirstCall().resolves({ rows: [{ compilation_id: "7" }] });
    query.onSecondCall().resolves({ rows: [{ id: "7" }] });

    await replaceSolidityStorageLayout(
      { database: { pool: { query } } } as any,
      verification(),
    );

    expect(query.callCount).to.equal(2);
    const updateSql = query.secondCall.args[0] as string;
    expect(updateSql).to.contain("compilation_artifacts = jsonb_set");
    expect(updateSql).to.contain("cc.language = 'solidity'");
    expect(updateSql).to.contain("compiler_settings = $4::jsonb");
    expect(updateSql).to.contain(
      "cc.compilation_artifacts->'storageLayout' IS NULL",
    );
    expect(updateSql).to.contain(
      "cc.compilation_artifacts->'storageLayout' = 'null'::jsonb",
    );
    expect(query.secondCall.args[1]).to.deep.equal([
      "7",
      "0.5.12+commit.7709ece9",
      "Fixture.sol:Fixture",
      '{"evmVersion":"petersburg"}',
      null,
      '{"Fixture.sol":"contract Fixture { address owner; }\\n"}',
      JSON.stringify(storageLayout),
    ]);
  });

  it("accepts the empty native layout shape", async () => {
    const query = sinon.stub();
    query.onFirstCall().resolves({ rows: [{ compilation_id: "7" }] });
    query.onSecondCall().resolves({ rows: [{ id: "7" }] });

    await replaceSolidityStorageLayout(
      { database: { pool: { query } } } as any,
      verification({ layout: { storage: [], types: null } }),
    );

    expect(query.secondCall.args[1][6]).to.equal('{"storage":[],"types":null}');
  });

  it("refuses identity mismatches and populated layouts", async () => {
    const query = sinon.stub();
    query.onFirstCall().resolves({ rows: [{ compilation_id: "7" }] });
    query.onSecondCall().resolves({ rows: [] });

    await expectFailure(
      replaceSolidityStorageLayout(
        { database: { pool: { query } } } as any,
        verification(),
      ),
      "already populated",
    );
  });
});

async function expectFailure(
  promise: Promise<unknown>,
  expectedMessage: string,
) {
  try {
    await promise;
    expect.fail("expected operation to fail");
  } catch (error) {
    expect((error as Error).message).to.contain(expectedMessage);
  }
}
