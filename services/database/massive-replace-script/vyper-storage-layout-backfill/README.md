# Historical Vyper storage-layout backfill

This resumable job recompiles one representative deployment for every Vyper
`compiled_contracts` row whose `compilation_artifacts.storageLayout` is null.
The private replacement method updates only that JSON field, so every deployment
sharing the compilation benefits without changing match data, bytecode artifacts,
or source associations.

Prerequisites:

- a server built with historical Vyper extraction and `replaceContract` enabled;
- `uv` available to the server (the production Docker image includes it);
- the massive-replace database/API variables in `services/database/.env`.

From `services/database`, run:

```bash
PGSSLMODE=no-verify \
CONFIG_FILE_PATH="$(pwd)/massive-replace-script/vyper-storage-layout-backfill/config-backfill-vyper-storage-layout.js" \
STORE_FAILED_CONTRACT_IDS=true \
  npm run massive-replace 2>&1 | tee "massive-replace-vyper-layout-$(date +%Y%m%d-%H%M%S).log"
```

The existing `CURRENT_VERIFIED_CONTRACT` cursor makes the job resumable. Set
`PROCESS_ONLY_ONE=true` for a one-contract smoke run. A failed batch still
advances the cursor, so a normal resume does not retry entries recorded in
`FAILED_CONTRACTS`. After reviewing the JSON-lines file, reset the cursor to
its lowest failed ID and rerun:

```bash
jq -sr 'map(.verifiedContractId | tonumber) | min' FAILED_CONTRACTS \
  > CURRENT_VERIFIED_CONTRACT
```

Successfully updated compilations no longer satisfy the candidate query, so
rewinding the cursor retries only layouts that are still missing. Archive or
clear `FAILED_CONTRACTS` after a clean retry to keep later retry sets distinct.

The candidate query deduplicates by `compiled_contracts.id`; reprocessing the
same compilation through several deployments would only repeat the same update.
When possible it chooses a representative address associated with only one
matched verified-contract row, avoiding ambiguous-address rejection by the
replacement endpoint.
If every deployment is ambiguous it keeps the lowest ID as a fallback so the
failure is recorded instead of silently omitting the compilation. Top-level
`additional_input`, including Vyper `storage_layout_overrides`, is merged back
into the verified Standard JSON input.
