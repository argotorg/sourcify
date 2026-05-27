-- migrate:up transaction:false

-- Composite index that drives the /v2/contracts/{chainId} pagination query.
-- The query orders by sourcify_matches.id and filters by chain_id; with
-- (chain_id, id DESC) PostgreSQL can scan straight to the wanted rows and
-- stop at LIMIT, instead of walking past chain-mismatched rows in the gap.
-- See: https://github.com/argotorg/sourcify/issues/2111
--
-- CONCURRENTLY is required so production verifications can keep writing
-- while the index builds. transaction:false is required because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS sourcify_matches_chain_id_id_desc_idx
    ON sourcify_matches USING btree (chain_id, id DESC);

-- migrate:down transaction:false

DROP INDEX CONCURRENTLY IF EXISTS sourcify_matches_chain_id_id_desc_idx;
