-- migrate:up

-- Metadata lives in compiled_contracts_metadata since 4.1.0 (#2924); the drop is instant, reclaim the space with pg_repack.
ALTER TABLE sourcify_matches DROP COLUMN metadata;

-- migrate:down

-- Instant, lets the previous server version run again with NULL metadata.
ALTER TABLE sourcify_matches ADD COLUMN metadata json;
