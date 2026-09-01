// Recompiles one representative deployment for every shared Vyper compilation
// whose stored storageLayout is null, then updates only that artifact through
// the private replace-contract API.
let candidateIds = null;

async function loadCandidateIds(sourcePool, sourcifySchema) {
  // The replace endpoint refuses an address with more than one matched
  // verified-contract row. Rank an unambiguous deployment first for each
  // shared compiled_contracts row, but retain an ambiguous fallback so it is
  // logged.
  const result = await sourcePool.query(`
    SELECT representative_id
    FROM (
      SELECT DISTINCT ON (cc.id)
        sm.id AS representative_id,
        cc.id AS compilation_id
      FROM ${sourcifySchema}.sourcify_matches sm
      JOIN ${sourcifySchema}.verified_contracts vc
        ON sm.verified_contract_id = vc.id
      JOIN ${sourcifySchema}.contract_deployments cd
        ON vc.deployment_id = cd.id
      JOIN ${sourcifySchema}.compiled_contracts cc
        ON vc.compilation_id = cc.id
      WHERE cc.language = 'vyper'
        AND (cc.compilation_artifacts->'storageLayout' IS NULL
             OR cc.compilation_artifacts->'storageLayout' = 'null'::jsonb)
      ORDER BY
        cc.id,
        NOT EXISTS (
          SELECT 1
          FROM ${sourcifySchema}.verified_contracts competing_vc
          JOIN ${sourcifySchema}.contract_deployments competing_cd
            ON competing_vc.deployment_id = competing_cd.id
          JOIN ${sourcifySchema}.sourcify_matches competing_sm
            ON competing_sm.verified_contract_id = competing_vc.id
          WHERE competing_cd.chain_id = cd.chain_id
            AND competing_cd.address = cd.address
            AND competing_sm.id <> sm.id
        ) DESC,
        sm.id
    ) candidates
    ORDER BY representative_id
  `);
  return result.rows.map((row) => Number(row.representative_id));
}

module.exports = {
  query: async (sourcePool, sourcifySchema, currentVerifiedContract, n) => {
    if (candidateIds === null) {
      console.log(
        "Precomputing one representative per Vyper compilation with a missing storage layout...",
      );
      candidateIds = await loadCandidateIds(sourcePool, sourcifySchema);
      console.log(`Found ${candidateIds.length} compilation candidates`);
    }

    const batchIds = candidateIds
      .filter((id) => id >= currentVerifiedContract)
      .slice(0, n);
    if (batchIds.length === 0) return { rows: [], rowCount: 0 };

    return await sourcePool.query(
      `
      SELECT
        cd.chain_id,
        cd.address,
        sm.id AS verified_contract_id,
        (
          jsonb_build_object(
            'language', INITCAP(cc.language),
            'sources', jsonb_object_agg(
              compiled_contracts_sources.path,
              jsonb_build_object('content', sources.content)
            ),
            'settings', cc.compiler_settings
          ) || COALESCE(cc.additional_input, '{}'::jsonb)
        ) AS std_json_input,
        cc.version AS compiler_version,
        cc.fully_qualified_name
      FROM ${sourcifySchema}.sourcify_matches sm
      JOIN ${sourcifySchema}.verified_contracts vc
        ON sm.verified_contract_id = vc.id
      JOIN ${sourcifySchema}.contract_deployments cd
        ON vc.deployment_id = cd.id
      JOIN ${sourcifySchema}.compiled_contracts cc
        ON vc.compilation_id = cc.id
      JOIN ${sourcifySchema}.compiled_contracts_sources
        ON compiled_contracts_sources.compilation_id = cc.id
      LEFT JOIN ${sourcifySchema}.sources
        ON sources.source_hash = compiled_contracts_sources.source_hash
      WHERE sm.id = ANY($1::bigint[])
      GROUP BY sm.id, vc.id, cc.id, cd.id
      ORDER BY sm.id
      `,
      [batchIds],
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
      customReplaceMethod: "replace-vyper-storage-layout",
    };
  },

  validateResult: (result) => {
    if (result.replaced !== true) {
      throw new Error(
        `Storage layout was not replaced: ${result.replacedReason || "unknown reason"}`,
      );
    }
  },

  description:
    "Backfills missing Vyper storage layouts once per shared compiled_contracts row.",
};
