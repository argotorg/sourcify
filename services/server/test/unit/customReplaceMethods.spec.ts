import { expect } from "chai";
import sinon from "sinon";
import { replaceVyperStorageLayout } from "../../src/server/apiPrivate/customReplaceMethods";
import { createRequire } from "module";

// Load the other workspace's runtime config without adding it to the server's
// TypeScript source tree (which is restricted to the server rootDir).
const backfillConfig = createRequire(__filename)(
  "../../../database/massive-replace-script/vyper-storage-layout-backfill/config-backfill-vyper-storage-layout.js",
);

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
  it("selects compilations missing only a recoverable transient layout", async () => {
    const query = sinon.stub();
    query.onFirstCall().resolves({
      rows: [
        {
          representative_id: "1",
          compiler_version: "0.3.7",
          missing_storage_layout: false,
        },
        {
          representative_id: "2",
          compiler_version: "0.4.0",
          missing_storage_layout: false,
        },
        {
          representative_id: "3",
          compiler_version: "0.4.1",
          missing_storage_layout: false,
        },
        {
          representative_id: "4",
          compiler_version: "0.2.16",
          missing_storage_layout: true,
        },
      ],
    });
    query.onSecondCall().resolves({ rows: [], rowCount: 0 });
    await backfillConfig.query({ query }, "public", 0, 10);
    expect(query.secondCall.args[1]).to.deep.equal([[2, 4]]);
  });
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
      "COALESCE(cc.compilation_artifacts, '{}'::jsonb) || $7::jsonb",
    );
    expect(query.secondCall.args[1]).to.deep.equal([
      "7",
      "0.2.15+commit.6e7dba7",
      "Fixture.vy:Fixture",
      '{"evmVersion":"london"}',
      null,
      '{"Fixture.vy":"owner: address\\n"}',
      '{"storageLayout":{}}',
    ]);
  });

  it("backfills both recovered namespaces in one identity-guarded update", async () => {
    const query = sinon.stub();
    query.onFirstCall().resolves({ rows: [{ compilation_id: "7" }] });
    query.onSecondCall().resolves({ rows: [{ id: "7" }] });
    const service = { database: { pool: { query } } } as any;
    const verification = verificationWithStatus("perfect");
    verification.compilation.contractCompilerOutput.transientStorageLayout = {
      temporary: { type: "uint256", slot: 1, n_slots: 1 },
    };

    await replaceVyperStorageLayout(service, verification);

    expect(JSON.parse(query.secondCall.args[1][6])).to.deep.equal(
      verification.compilation.contractCompilerOutput,
    );
  });

  it("preserves stored persistent layout when only transient layout is recovered", async () => {
    const query = sinon.stub();
    query.onFirstCall().resolves({ rows: [{ compilation_id: "7" }] });
    query.onSecondCall().resolves({ rows: [{ id: "7" }] });
    const service = { database: { pool: { query } } } as any;
    const verification = verificationWithStatus("perfect");
    verification.compilation.contractCompilerOutput = {
      transientStorageLayout: {},
    };

    await replaceVyperStorageLayout(service, verification);

    expect(JSON.parse(query.secondCall.args[1][6])).to.deep.equal({
      transientStorageLayout: {},
    });
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
