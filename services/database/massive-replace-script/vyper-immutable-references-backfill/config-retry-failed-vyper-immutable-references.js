// Retry config: re-process ONLY the contracts that previously failed (e.g. Vyper KeyError),
// read from keyerror-extra-sources.tsv produced by parse-keyerror-logs.js.
//
// Why: the main backfill config re-scans every Vyper contract whose immutableReferences is
// still null. Contracts that genuinely have no immutables stay null (correct — same as a fresh
// verification), so a full re-run needlessly re-compiles every no-op again. After you've deleted
// the contaminant sources, you only need to re-run the handful that errored — this config does that.
//
// Usage (after running parse-keyerror-logs.js and applying the DELETE):
//   cd services/database
//   echo 1 > CURRENT_VERIFIED_CONTRACT      # fresh cursor for the retry id-space
//   CONFIG_FILE_PATH=./massive-replace-script/config-retry-failed-vyper-immutable-references.js \
//     npm run massive-replace
//
// The TSV path defaults to ../keyerror-extra-sources.tsv (services/database). Override with RETRY_TSV.

const fs = require("fs");
const path = require("path");

// Reuse the main config's request builder (and its STRIP_SOURCE_HASHES belt-and-suspenders),
// so the retried requests are byte-for-byte what the main run would have sent.
const {
  buildRequestBody,
} = require("./config-backfill-vyper-immutable-references.js");

// Cache of the failed sourcify_matches ids (ascending), resolved once from the TSV.
let candidateIds = null;

function readFailedPairs() {
  // parse-keyerror-logs.js writes the TSV to the directory you run it from (the same
  // services/database working dir the backfill runs from), so anchor to cwd, not __dirname.
  const tsvPath =
    process.env.RETRY_TSV ||
    path.join(process.cwd(), "keyerror-extra-sources.tsv");
  const text = fs.readFileSync(tsvPath, "utf8");
  const chains = [];
  const addrsHex = [];
  const seen = new Set();
  for (const line of text.split("\n").slice(1)) {
    // skip header
    const cols = line.split("\t");
    if (cols.length < 2) continue;
    const chainId = (cols[0] || "").trim();
    const addr = (cols[1] || "").trim().replace(/^0x/i, "").toLowerCase();
    if (!chainId || !/^[0-9a-f]{40}$/.test(addr)) continue;
    const key = `${chainId}|${addr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chains.push(chainId);
    addrsHex.push(addr);
  }
  return { chains, addrsHex };
}

async function loadFailedCandidateIds(sourcePool, sourcifySchema) {
  const { chains, addrsHex } = readFailedPairs();
  if (chains.length === 0) return [];
  const result = await sourcePool.query(
    `
    SELECT DISTINCT sm.id
    FROM ${sourcifySchema}.sourcify_matches sm
    JOIN ${sourcifySchema}.verified_contracts vc ON sm.verified_contract_id = vc.id
    JOIN ${sourcifySchema}.contract_deployments cd ON vc.deployment_id = cd.id
    JOIN unnest($1::numeric[], $2::text[]) AS f(chain_id, addr_hex)
      ON cd.chain_id = f.chain_id
     AND cd.address = decode(f.addr_hex, 'hex')
    ORDER BY sm.id ASC
  `,
    [chains, addrsHex],
  );
  return result.rows.map((row) => Number(row.id));
}

module.exports = {
  query: async (sourcePool, sourcifySchema, currentVerifiedContract, n) => {
    if (candidateIds === null) {
      console.log(
        "Loading previously-failed contracts from keyerror-extra-sources.tsv ...",
      );
      candidateIds = await loadFailedCandidateIds(sourcePool, sourcifySchema);
      console.log(`Found ${candidateIds.length} failed contracts to retry`);
    }

    const batchIds = candidateIds
      .filter((id) => id >= currentVerifiedContract)
      .slice(0, n);
    if (batchIds.length === 0) {
      return { rows: [], rowCount: 0 };
    }

    // Same fetch shape as the main config, by exact sourcify_matches id.
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
  buildRequestBody,
  description:
    "Retries ONLY the contracts listed in keyerror-extra-sources.tsv (previously-failed backfill contracts), after their contaminant sources were deleted. Avoids re-processing the full candidate set.",
};
