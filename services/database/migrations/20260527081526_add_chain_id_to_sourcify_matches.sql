-- migrate:up

-- Add chain_id column to sourcify_matches to enable a composite index
-- (chain_id, id DESC) for efficient pagination of /v2/contracts/{chainId}.
-- See: https://github.com/argotorg/sourcify/issues/2111
--
-- Nullable for now: existing rows are backfilled via
-- services/database/scripts/backfill-sourcify-match-chain-id.mjs.
-- A subsequent migration will set NOT NULL after the backfill completes.
ALTER TABLE sourcify_matches ADD COLUMN chain_id bigint;

-- migrate:down

ALTER TABLE sourcify_matches DROP COLUMN chain_id;
