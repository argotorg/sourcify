-- migrate:up

ALTER TABLE verification_jobs ADD external_verification jsonb NULL;

-- migrate:down

ALTER TABLE verification_jobs DROP COLUMN external_verification;
