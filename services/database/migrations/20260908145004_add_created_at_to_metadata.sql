-- migrate:up

/* Needed for Parquet Export v2. */

ALTER TABLE compiled_contracts_metadata
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT NOW();

CREATE TRIGGER insert_set_created_at
    BEFORE INSERT ON compiled_contracts_metadata
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_created_at();

CREATE TRIGGER update_reuse_created_at
    BEFORE UPDATE ON compiled_contracts_metadata
    FOR EACH ROW
    EXECUTE FUNCTION trigger_reuse_created_at();

CREATE INDEX compiled_contracts_metadata_created_at ON compiled_contracts_metadata USING btree(created_at);

-- migrate:down

DROP INDEX IF EXISTS compiled_contracts_metadata_created_at;

DROP TRIGGER IF EXISTS update_reuse_created_at ON compiled_contracts_metadata;
DROP TRIGGER IF EXISTS insert_set_created_at ON compiled_contracts_metadata;

ALTER TABLE compiled_contracts_metadata
    DROP COLUMN IF EXISTS created_at;
