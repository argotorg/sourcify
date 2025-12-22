-- migrate:up

/*
  Add indexes on created_at/updated_at columns for Sourcify-specific tables.
  These indexes are required for the Parquet Export v2:
  https://github.com/argotorg/sourcify/issues/2441

  The indexes enable efficient append-only Parquet exports by allowing queries
  to order records by timestamp, generating only new data since the last 
  export.
*/

CREATE INDEX signatures_created_at ON signatures USING btree(created_at);
CREATE INDEX compiled_contracts_signatures_created_at ON compiled_contracts_signatures USING btree(created_at);
CREATE INDEX sourcify_matches_updated_at ON sourcify_matches USING btree(updated_at);

-- migrate:down

DROP INDEX IF EXISTS signatures_created_at;
DROP INDEX IF EXISTS compiled_contracts_signatures_created_at;
DROP INDEX IF EXISTS sourcify_matches_updated_at;
