-- migrate:up transaction:false

-- Index on the verification_jobs.verified_contract_id FK column. Without it,
-- every DELETE on verified_contracts triggers a sequential scan of
-- verification_jobs for the RI check of
-- verification_jobs_verified_contract_id_fk (one scan per deleted row),
-- which makes contract deletions (scripts/delete-sourcify-match) take
-- minutes instead of milliseconds.
--
-- CONCURRENTLY is required so production verifications can keep writing
-- while the index builds. transaction:false is required because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS verification_jobs_verified_contract_id_idx
    ON verification_jobs USING btree (verified_contract_id);

-- migrate:down transaction:false

DROP INDEX CONCURRENTLY IF EXISTS verification_jobs_verified_contract_id_idx;
