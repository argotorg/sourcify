-- migrate:up

-- Compiler metadata describes a compilation, not a deployment, yet it is
-- stored once per verified contract in sourcify_matches.metadata. With one
-- compilation deployed at thousands of addresses this duplicates identical
-- blobs 8.5x on average (~139 GB of a 182 GB table).
-- See: https://github.com/argotorg/sourcify/issues/2924
--
-- This table holds one metadata blob per compilation instead. It is a
-- Sourcify-specific side table (same pattern as sourcify_matches and
-- compiled_contracts_runtime_code_prefixes): compiled_contracts belongs to the
-- Verifier Alliance schema and is left untouched structurally.
--
-- Where a compilation has several metadata variants (possible with
-- settings.metadata.bytecodeHash: "none", where differing comments or paths
-- still produce identical bytecode), the first submitter's variant wins --
-- consistent with how sources are deduplicated for a shared compilation.
--
-- The column is json, NOT jsonb, deliberately: json preserves the exact
-- stored text, so the blob keeps hashing to the metadata hash embedded in the
-- onchain bytecode. jsonb re-serializes with its own key order and would break
-- that property permanently.
--
-- This migration only creates the table:
--   - New compilations are covered by the server, which writes metadata here
--     at verification time (dual-writing to sourcify_matches.metadata for now).
--   - Existing rows are backfilled out-of-band by the (idempotent, resumable)
--     script services/database/schema-updates/backfill-compiled-contracts-metadata.mjs.
--     Backfilling all ~5M compilations in here would detoast and rewrite tens
--     of GB inside one transaction, which is not acceptable on production.
--   - Reads stay on sourcify_matches.metadata until the backfill has completed;
--     switching them over and dropping the old column are follow-up steps.
CREATE TABLE compiled_contracts_metadata (
    compilation_id uuid NOT NULL PRIMARY KEY
        REFERENCES compiled_contracts(id) ON DELETE CASCADE,
    metadata json NOT NULL
);

-- migrate:down

DROP TABLE IF EXISTS compiled_contracts_metadata;
