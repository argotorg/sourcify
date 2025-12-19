-- migrate:up

CREATE INDEX signatures_created_at ON signatures USING btree(created_at);
CREATE INDEX compiled_contracts_signatures_created_at ON compiled_contracts_signatures USING btree(created_at);
CREATE INDEX sourcify_matches_updated_at ON sourcify_matches USING btree(updated_at);

-- migrate:down

DROP INDEX IF EXISTS signatures_created_at;
DROP INDEX IF EXISTS compiled_contracts_signatures_created_at;
DROP INDEX IF EXISTS sourcify_matches_updated_at;
