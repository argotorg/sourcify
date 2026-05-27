-- migrate:up

-- Promote sourcify_matches.chain_id to NOT NULL without locking the table for
-- a full scan. The ADD CONSTRAINT … NOT VALID step is metadata-only; the
-- VALIDATE CONSTRAINT step scans the table but only takes a
-- ShareUpdateExclusiveLock, so writes continue. PostgreSQL ≥ 12 then
-- short-circuits SET NOT NULL by reusing the validated CHECK, avoiding a
-- second scan. The constraint is dropped afterward since the column-level
-- NOT NULL is now sufficient.
--
-- This migration must be applied AFTER the backfill script has reported
-- 0 NULL rows: services/database/schema-updates/post-v2.12-to-v2.13-upgrade.mjs.
-- See: https://github.com/argotorg/sourcify/issues/2111
ALTER TABLE sourcify_matches
    ADD CONSTRAINT sourcify_matches_chain_id_not_null
    CHECK (chain_id IS NOT NULL) NOT VALID;

ALTER TABLE sourcify_matches
    VALIDATE CONSTRAINT sourcify_matches_chain_id_not_null;

ALTER TABLE sourcify_matches ALTER COLUMN chain_id SET NOT NULL;

ALTER TABLE sourcify_matches
    DROP CONSTRAINT sourcify_matches_chain_id_not_null;

-- migrate:down

ALTER TABLE sourcify_matches ALTER COLUMN chain_id DROP NOT NULL;
