# Metadata read switch (#2942)

## before

- This version reads metadata only from `compiled_contracts_metadata`: confirm the backfill has completed on production by running `backfill-compiled-contracts-metadata.mjs --verify` and checking it reports `missingRows: 0`
