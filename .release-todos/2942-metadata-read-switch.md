# Metadata read switch (#2942)

## before

- This version reads metadata only from `compiled_contracts_metadata`: confirm the backfill has completed on production by running `backfill-compiled-contracts-metadata.mjs --verify` and checking it reports `missingRows: 0`
- Deploy the parquet-export changes (export `compiled_contracts_metadata`, drop the `metadata` column from the `sourcify_matches` export) BEFORE this version: once this server stops writing `sourcify_matches.metadata`, the old export writes null metadata for new and re-verified matches
