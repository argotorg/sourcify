# Metadata read switch (#2942)

## before

- This version reads metadata only from `compiled_contracts_metadata`: confirm the backfill has completed on production by running `backfill-compiled-contracts-metadata.mjs --verify` and checking it reports `missingRows: 0`
- Deploy the parquet-export changes (export `compiled_contracts_metadata`, drop the `metadata` column from the `sourcify_matches` export) BEFORE this version: once this server stops writing `sourcify_matches.metadata`, the old export writes null metadata for new and re-verified matches
- Do NOT run `npm run migrate:up` before the deploy: the pending migrations include the drop of `sourcify_matches.metadata`, which the previous server version still reads and writes. Both pending migrations run after the deploy, see below

## after

- Run `npm run migrate:up` on the staging database
- Run `npm run migrate:up` on the production database. This applies #2963 (adds `created_at` to `compiled_contracts_metadata` without a table rewrite; the index build blocks inserts into the table for a short time) and the drop of `sourcify_matches.metadata` (instant, catalog only)
- Rollback: `npm run migrate:rollback` re-adds the column instantly as nullable, then the previous server version runs again with NULL metadata until rolled forward
- Reclaim the ~139 GB with `pg_repack` on `sourcify_matches` (see #2924)
