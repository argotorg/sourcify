# Vyper `immutableReferences` backfill

Backfills missing `immutableReferences` for already-verified Vyper contracts ([#2827](https://github.com/argotorg/sourcify/issues/2827)) via the `/private/replace-contract` API and the massive-replace-script.

Some Vyper rows carry extra sources appended by the compiled-contracts dedup bug ([#2858](https://github.com/argotorg/sourcify/issues/2858)); those break recompilation with a Vyper `KeyError`. The flow below runs the backfill, then removes exactly the offending sources and retries only the affected contracts.

Files:

- `config-backfill-vyper-immutable-references.js` — massive-replace config that re-compiles every candidate Vyper contract and backfills its `immutableReferences`.
- `parse-keyerror-logs.js` — reads the run logs, extracts the `(chain, address, file)` that hit a `KeyError`, and writes `keyerror-extra-sources.tsv` + `delete-keyerror-sources.sql`.
- `config-retry-failed-vyper-immutable-references.js` — retries only the contracts in `keyerror-extra-sources.tsv` (so no-op contracts aren't re-processed).

Prerequisites: a running server with the `replaceContract` flag enabled, and the massive-replace `.env` (`POSTGRES_*`, `API_BASE_URL`, `API_AUTH_TOKEN`). Run everything from `services/database`.

## Steps

**1. Run the backfill.**

```bash
PGSSLMODE=no-verify \
CONFIG_FILE_PATH="$(pwd)/massive-replace-script/vyper-immutable-references-backfill/config-backfill-vyper-immutable-references.js" \
  npm run massive-replace 2>&1 | tee "massive-replace-$(date +%Y%m%d-%H%M%S).log"
```

**2. Parse the log, then delete the offending sources.**

```bash
node massive-replace-script/vyper-immutable-references-backfill/parse-keyerror-logs.js massive-replace-*.log
```

Review `delete-keyerror-sources.sql` (run its preview `SELECT`), then run its `DELETE` against the database.

**3. Retry only the failed contracts.**

```bash
echo 1 > CURRENT_VERIFIED_CONTRACT   # fresh cursor for the retry id-space
PGSSLMODE=no-verify \
CONFIG_FILE_PATH="$(pwd)/massive-replace-script/vyper-immutable-references-backfill/config-retry-failed-vyper-immutable-references.js" \
  npm run massive-replace 2>&1 | tee "massive-replace-after-fix-$(date +%Y%m%d-%H%M%S).log"
```

**4. If new `KeyError`s appear, repeat steps 2–3.** With no file argument the parser defaults to the `massive-replace-after-fix-*.log` retry logs, so just re-run it, apply the new `DELETE`, and retry again until the logs are clean.
