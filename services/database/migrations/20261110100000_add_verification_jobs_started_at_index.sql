-- migrate:up transaction:false

-- For the retention cleanup in the next migration, see https://github.com/argotorg/sourcify/issues/3028
CREATE INDEX CONCURRENTLY IF NOT EXISTS verification_jobs_started_at_idx
    ON verification_jobs USING btree (started_at);

-- migrate:down transaction:false

DROP INDEX CONCURRENTLY IF EXISTS verification_jobs_started_at_idx;
