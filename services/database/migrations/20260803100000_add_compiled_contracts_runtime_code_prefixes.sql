-- migrate:up

-- Similarity search needs to find compilations whose runtime code starts with
-- the same bytes as a target contract. The existing idx_code_code_first_75 on
-- the code table cannot serve this efficiently: code holds every bytecode ever
-- observed on chain, and for contract classes that bake immutables into their
-- runtime code (e.g. Uniswap V3-style pools) hundreds of thousands of onchain
-- variants share a prefix while only a handful of compilations exist. A prefix
-- scan on code then walks the whole variant set to find the few compiled
-- candidates (measured in production: 142,872 rows scanned for 21 candidates,
-- 36s). Indexing the prefix over compilations makes every index entry a
-- candidate, so a LIMIT short-circuits after ~LIMIT entries.
-- See: https://github.com/argotorg/sourcify/issues/2891
--
-- This is a Sourcify-specific side table (same pattern as sourcify_matches):
-- compiled_contracts belongs to the Verifier Alliance schema and is left
-- untouched structurally.
--
-- The prefix length (75 bytes) must stay consistent with the server's
-- similarity query and the backfill script:
-- services/database/schema-updates/backfill-compiled-contracts-runtime-code-prefixes.mjs
--
-- New compiled_contracts rows are covered by the trigger below. Existing rows
-- are backfilled out-of-band by the (idempotent, resumable) script above; until
-- the backfill completes, similarity search simply sees fewer candidates.
--
-- Bytecodes shorter than 75 bytes are excluded entirely (no prefix row): a
-- sub-75-byte prefix is a weak discriminator (e.g. minimal proxies), and the
-- server rejects similarity requests for such bytecodes as well. Every stored
-- prefix is therefore exactly 75 bytes, which the CHECK enforces.
CREATE TABLE compiled_contracts_runtime_code_prefixes (
    compilation_id uuid NOT NULL PRIMARY KEY
        REFERENCES compiled_contracts(id) ON DELETE CASCADE,
    runtime_code_prefix bytea NOT NULL,
    CONSTRAINT runtime_code_prefix_length_check
        CHECK (octet_length(runtime_code_prefix) = 75)
);

CREATE INDEX compiled_contracts_runtime_code_prefixes_prefix_idx
    ON compiled_contracts_runtime_code_prefixes USING btree (runtime_code_prefix);

-- Fills the prefix table for every new compilation. An error inside a trigger
-- would abort the compiled_contracts insert itself, so compilations without a
-- usable prefix (NULL code or shorter than 75 bytes) are skipped silently --
-- they can never be similarity candidates anyway.
--
-- No UPDATE trigger: runtime_code_hash never changes after insert.
CREATE FUNCTION insert_compiled_contracts_runtime_code_prefix()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO compiled_contracts_runtime_code_prefixes (compilation_id, runtime_code_prefix)
    SELECT NEW.id, substring(code.code FROM 1 FOR 75)
    FROM code
    WHERE code.code_hash = NEW.runtime_code_hash
      AND code.code IS NOT NULL
      AND octet_length(code.code) >= 75
    ON CONFLICT (compilation_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER insert_runtime_code_prefix
    AFTER INSERT ON compiled_contracts
    FOR EACH ROW
    EXECUTE FUNCTION insert_compiled_contracts_runtime_code_prefix();

-- migrate:down

DROP TRIGGER IF EXISTS insert_runtime_code_prefix ON compiled_contracts;
DROP FUNCTION IF EXISTS insert_compiled_contracts_runtime_code_prefix();
DROP TABLE IF EXISTS compiled_contracts_runtime_code_prefixes;
