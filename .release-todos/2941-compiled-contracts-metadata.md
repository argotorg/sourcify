# Metadata side table (#2941)

## before

- Run `npm run migrate:up` on the staging and production databases (creates the empty `compiled_contracts_metadata` table, instant)

## after

- Run `services/database/schema-updates/backfill-compiled-contracts-metadata.mjs` against production (see "Available upgrade scripts" in `services/database/README.md`)
- Run the script again with `--verify` and check it reports `missingRows: 0`
- In the GCP Datastream console, add `compiled_contracts_metadata` to the included objects of the `sourcify-matches` stream (the stream's backfill mode picks up the new table automatically)
- Only after all of the above, merge and deploy the read-switch PR #2942
