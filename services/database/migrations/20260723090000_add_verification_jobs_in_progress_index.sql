-- migrate:up transaction:false

-- Partial index backing the stale verification-job reaper query, which finds
-- in-progress jobs via `WHERE completed_at IS NULL AND started_at < <cutoff>`.
-- verification_jobs is huge (~77M rows / ~50GB), so without an index that query
-- degrades to a multi-minute parallel sequential scan. This index only covers
-- the tiny set of currently in-flight rows (completed_at IS NULL), so it stays
-- very small regardless of how large the table grows and keeps the reaper
-- lookup sub-millisecond.
-- See: https://github.com/argotorg/sourcify/issues/2880
--
-- CONCURRENTLY is required so production verifications can keep writing
-- while the index builds. transaction:false is required because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS verification_jobs_in_progress_idx
    ON verification_jobs USING btree (started_at)
    WHERE completed_at IS NULL;

-- migrate:down transaction:false

DROP INDEX CONCURRENTLY IF EXISTS verification_jobs_in_progress_idx;
