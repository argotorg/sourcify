import { expect } from "chai";
import sinon from "sinon";
import { replaceVyperStorageLayout } from "../../src/server/apiPrivate/customReplaceMethods";

function verificationWithStatus(runtimeMatch: "perfect" | "partial" | null) {
  return {
    address: "0x0000000000000000000000000000000000000001",
    chainId: 1,
    status: { runtimeMatch, creationMatch: null },
    compilation: {
      language: "Vyper",
      compilerVersion: "0.2.15+commit.6e7dba7",
      compilationTarget: { path: "Fixture.vy", name: "Fixture" },
      sources: { "Fixture.vy": "owner: address\n" },
      jsonInput: { settings: { evmVersion: "london" } },
      contractCompilerOutput: { storageLayout: {} },
    },
  } as any;
}

describe("replaceVyperStorageLayout", () => {
  it("rejects a layout from a compilation that did not match", async () => {
    const query = sinon.stub();
    const service = { database: { pool: { query } } } as any;

    try {
      await replaceVyperStorageLayout(service, verificationWithStatus(null));
      expect.fail("expected replacement to be rejected");
    } catch (error) {
      expect((error as Error).message).to.contain(
        "did not match the deployment",
      );
    }
    expect(query.called).to.equal(false);
  });

  it("writes an empty recovered layout without replacing other artifacts", async () => {
    const query = sinon.stub();
    query.onFirstCall().resolves({ rows: [{ compilation_id: "7" }] });
    query.onSecondCall().resolves({ rows: [{ id: "7" }] });
    const service = { database: { pool: { query } } } as any;

    await replaceVyperStorageLayout(service, verificationWithStatus("perfect"));

    expect(query.callCount).to.equal(2);
    expect(query.secondCall.args[0]).to.contain(
      "compiler_settings = $4::jsonb",
    );
    expect(query.secondCall.args[0]).to.contain(
      "compilation_artifacts = jsonb_set",
    );
    expect(query.secondCall.args[1]).to.deep.equal([
      "7",
      "0.2.15+commit.6e7dba7",
      "Fixture.vy:Fixture",
      '{"evmVersion":"london"}',
      null,
      '{"Fixture.vy":"owner: address\\n"}',
      "{}",
    ]);
  });

  it("refuses to overwrite a different stored compilation identity", async () => {
    const query = sinon.stub();
    query.onFirstCall().resolves({ rows: [{ compilation_id: "7" }] });
    query.onSecondCall().resolves({ rows: [] });
    const service = { database: { pool: { query } } } as any;

    try {
      await replaceVyperStorageLayout(
        service,
        verificationWithStatus("perfect"),
      );
      expect.fail("expected replacement to be rejected");
    } catch (error) {
      expect((error as Error).message).to.contain(
        "does not match the stored compilation",
      );
    }
    expect(query.callCount).to.equal(2);
  });
});
