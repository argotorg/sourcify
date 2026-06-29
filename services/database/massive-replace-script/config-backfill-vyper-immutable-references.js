// Configuration for backfilling missing Vyper `immutableReferences`.
// Vyper `immutableReferences` were historically never persisted: every Vyper row in
// compiled_contracts has runtime_code_artifacts -> 'immutableReferences' set to null,
// even for contracts that genuinely have immutables. This config re-verifies affected
// contracts with forceCompilation=true (required to recover the IR-derived size for
// legacy < 0.3.10 contracts) and backfills the references via the
// "replace-vyper-immutable-references" custom replace method.
// Issue: https://github.com/argotorg/sourcify/issues/2827

// Vyper supports `immutable()` from 0.3.1 onwards. Contracts compiled with an older
// version can never have immutables, so we skip them to avoid pointless recompiles.
const MIN_VYPER_IMMUTABLES_VERSION = [0, 3, 1];

function parseVyperVersion(version) {
  // version looks like "0.3.10+commit.91361694" (sometimes prefixed, e.g. "vyper:0.3.10")
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version || "");
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(version, minimum) {
  const parsed = parseVyperVersion(version);
  if (!parsed) return false;
  for (let i = 0; i < 3; i++) {
    if (parsed[i] > minimum[i]) return true;
    if (parsed[i] < minimum[i]) return false;
  }
  return true; // equal
}

module.exports = {
  query: async (sourcePool, sourcifySchema, currentVerifiedContract, n) => {
    return await sourcePool.query(
      `
      SELECT
          cd.chain_id,
          cd.address,
          sm.id as verified_contract_id,
          json_build_object(
            'language', INITCAP(cc.language),
            'sources', json_object_agg(compiled_contracts_sources.path, json_build_object('content', sources.content)),
            'settings', cc.compiler_settings
          ) as std_json_input,
          cc.version as compiler_version,
          cc.fully_qualified_name
      FROM ${sourcifySchema}.sourcify_matches sm
      JOIN ${sourcifySchema}.verified_contracts vc ON sm.verified_contract_id = vc.id
      JOIN ${sourcifySchema}.contract_deployments cd ON vc.deployment_id = cd.id
      JOIN ${sourcifySchema}.compiled_contracts cc ON vc.compilation_id = cc.id
      JOIN ${sourcifySchema}.compiled_contracts_sources ON compiled_contracts_sources.compilation_id = cc.id
      LEFT JOIN ${sourcifySchema}.sources ON sources.source_hash = compiled_contracts_sources.source_hash
      WHERE cc.language = 'vyper'
          AND (cc.runtime_code_artifacts->'immutableReferences' IS NULL
               OR cc.runtime_code_artifacts->'immutableReferences' = 'null'::jsonb)
          AND sm.id >= $1
      GROUP BY sm.id, vc.id, cc.id, cd.id
      ORDER BY sm.id ASC
      LIMIT $2
    `,
      [currentVerifiedContract, n],
    );
  },
  buildRequestBody: (contract) => {
    return {
      chainId: contract.chain_id.toString(),
      address: `0x${contract.address.toString("hex")}`,
      forceCompilation: true,
      jsonInput: contract.std_json_input,
      compilerVersion: contract.compiler_version,
      compilationTarget: contract.fully_qualified_name,
      forceRPCRequest: false,
      customReplaceMethod: "replace-vyper-immutable-references",
    };
  },
  excludeContract: (contract) => {
    if (!isAtLeast(contract.compiler_version, MIN_VYPER_IMMUTABLES_VERSION)) {
      const address = `0x${contract.address.toString("hex")}`;
      console.log(
        `Contract address=${address}, chain_id=${contract.chain_id}: Vyper ${contract.compiler_version} predates immutables (< 0.3.1) -> skipping`,
      );
      return true;
    }
    return false;
  },
  description:
    "Backfills missing Vyper immutableReferences into runtime_code_artifacts by re-compiling and re-verifying affected contracts (issue #2827).",
};
