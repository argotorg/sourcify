// Configuration for backfilling missing Vyper `immutableReferences`.
// Vyper `immutableReferences` were historically never persisted: every Vyper row in
// compiled_contracts has runtime_code_artifacts -> 'immutableReferences' set to null,
// even for contracts that genuinely have immutables. This config re-verifies affected
// contracts with forceCompilation=true (required to recover the IR-derived size for
// legacy < 0.3.10 contracts) and backfills the references via the
// "replace-vyper-immutable-references" custom replace method.
// Issue: https://github.com/argotorg/sourcify/issues/2827
//
// Performance: Vyper rows are rare relative to the whole sourcify_matches table, so
// re-running the filtered+ordered scan on every batch is prohibitively slow on a large
// (production) database. Instead we compute the full list of candidate sourcify_matches
// ids ONCE (a single scan) and cache it; each batch then fetches its contracts by exact
// id (indexed primary-key lookups). The one-time scan also applies the version filter
// (Vyper supports immutables from 0.3.1; older versions can never have any).

// Cache of candidate sourcify_matches ids (ascending). Populated on the first query()
// call and reused for the rest of the run. A fresh run (e.g. resume) recomputes it once.
let candidateIds = null;

const { createHash } = require("crypto");

// Some multi-source bundles carry extra sibling sources that aren't the verification
// target (e.g. PancakeStableSwapNG.vy alongside CurveStableSwapNG.vy). Vyper throws
// `KeyError: '<file>'` for any source not listed in outputSelection, and
// VyperCompilation hardcodes outputSelection to the target file only — so these extra
// sources break recompilation. We strip them from the rebuilt jsonInput (unless the
// extra source IS the target). Values are the sha256 of the source content, which is
// exactly sources.source_hash, lowercased. See issue #2827 discussion.
const STRIP_SOURCE_HASHES = new Set([
  "d6996b3164da78f2f64e71176b72fcebdcb7cfb147b52ab4fb978a6e7d023b04", // PancakeStableSwapNG.vy
]);

async function loadCandidateIds(sourcePool, sourcifySchema) {
  const result = await sourcePool.query(`
    SELECT sm.id
    FROM ${sourcifySchema}.sourcify_matches sm
    JOIN ${sourcifySchema}.verified_contracts vc ON sm.verified_contract_id = vc.id
    JOIN ${sourcifySchema}.compiled_contracts cc ON vc.compilation_id = cc.id
    CROSS JOIN LATERAL (
      SELECT regexp_match(cc.version, '(\\d+)\\.(\\d+)\\.(\\d+)') AS p
    ) m
    WHERE cc.language = 'vyper'
      AND (cc.runtime_code_artifacts->'immutableReferences' IS NULL
           OR cc.runtime_code_artifacts->'immutableReferences' = 'null'::jsonb)
      AND m.p IS NOT NULL
      AND (m.p[1]::int, m.p[2]::int, m.p[3]::int) >= (0, 3, 1)
    ORDER BY sm.id ASC
  `);
  // sourcify_matches.id comes back as a string (bigint); ids are well within the
  // safe-integer range, so Number() is fine and keeps the cursor comparison numeric.
  return result.rows.map((row) => Number(row.id));
}

module.exports = {
  query: async (sourcePool, sourcifySchema, currentVerifiedContract, n) => {
    if (candidateIds === null) {
      console.log(
        "Precomputing Vyper backfill candidates (one-time scan, may take a while on large DBs)...",
      );
      candidateIds = await loadCandidateIds(sourcePool, sourcifySchema);
      console.log(`Found ${candidateIds.length} candidate contracts`);
    }

    // Take the next n candidates at or after the cursor.
    const batchIds = candidateIds
      .filter((id) => id >= currentVerifiedContract)
      .slice(0, n);

    if (batchIds.length === 0) {
      return { rows: [], rowCount: 0 };
    }

    // Fetch the full rows (with sources) for just these ids — fast PK/index lookups.
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
      WHERE sm.id = ANY($1::bigint[])
      GROUP BY sm.id, vc.id, cc.id, cd.id
      ORDER BY sm.id ASC
    `,
      [batchIds],
    );
  },
  buildRequestBody: (contract) => {
    const jsonInput = contract.std_json_input;
    // Target source path from the fully qualified name ("path:name" -> "path").
    const targetPath = contract.fully_qualified_name
      .split(":")
      .slice(0, -1)
      .join(":");
    // Drop known extra (non-target) sources that break Vyper recompilation. Match by
    // sha256 of the content (= sources.source_hash) so it's path-independent.
    if (jsonInput && jsonInput.sources) {
      for (const path of Object.keys(jsonInput.sources)) {
        if (path === targetPath) continue;
        const content = jsonInput.sources[path]?.content ?? "";
        const hash = createHash("sha256").update(content).digest("hex");
        if (STRIP_SOURCE_HASHES.has(hash)) {
          delete jsonInput.sources[path];
        }
      }
    }
    return {
      chainId: contract.chain_id.toString(),
      address: `0x${contract.address.toString("hex")}`,
      forceCompilation: true,
      jsonInput,
      compilerVersion: contract.compiler_version,
      compilationTarget: contract.fully_qualified_name,
      forceRPCRequest: false,
      customReplaceMethod: "replace-vyper-immutable-references",
    };
  },
  description:
    "Backfills missing Vyper immutableReferences into runtime_code_artifacts by re-compiling and re-verifying affected contracts (issue #2827).",
};
