-- migrate:up

-- One metadata blob per compilation instead of one per verified contract
-- (~139 GB of duplicates in sourcify_matches.metadata, see issue #2924).
-- Sourcify-specific side table; the Verifier Alliance compiled_contracts
-- table stays untouched. json, not jsonb: preserves the exact text so the
-- blob keeps hashing to the metadata hash embedded in the onchain bytecode.
--
-- Table only: the server dual-writes new verifications; existing rows are
-- backfilled by schema-updates/backfill-compiled-contracts-metadata.mjs.
-- Reads stay on sourcify_matches.metadata until the backfill completes.
CREATE TABLE compiled_contracts_metadata (
    compilation_id uuid NOT NULL PRIMARY KEY
        REFERENCES compiled_contracts(id) ON DELETE CASCADE,
    metadata json NOT NULL
);

-- migrate:down

DROP TABLE IF EXISTS compiled_contracts_metadata;
