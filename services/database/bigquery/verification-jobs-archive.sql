-- Daily archive of verification_jobs and verification_jobs_ephemeral, see the README of services/database.
-- Before you create the scheduled query, replace CONNECTION and BUCKET.

-- Each run writes one UTC day. After 2 days a job row does not change any more.
DECLARE day DATE DEFAULT DATE_SUB(@run_date, INTERVAL 2 DAY);
DECLARE day_start STRING DEFAULT FORMAT('%tT00:00:00Z', day);
DECLARE day_end STRING DEFAULT FORMAT('%tT00:00:00Z', DATE_ADD(day, INTERVAL 1 DAY));

-- EXTERNAL_QUERY does not support uuid and jsonb, so Postgres casts them to text.
EXECUTE IMMEDIATE FORMAT("""
  EXPORT DATA OPTIONS (
    uri = 'gs://BUCKET/verification_jobs/dt=%t/*.parquet',
    format = 'PARQUET',
    compression = 'ZSTD',
    overwrite = true
  ) AS
  SELECT * FROM EXTERNAL_QUERY('CONNECTION', '''
    SELECT id::text AS id, started_at, completed_at, chain_id, contract_address,
      verified_contract_id, error_code, error_id::text AS error_id,
      error_data::text AS error_data, verification_endpoint, hardware, compilation_time,
      external_verification::text AS external_verification
    FROM public.verification_jobs
    WHERE started_at >= '%s' AND started_at < '%s'
  ''')
""", day, day_start, day_end);

-- The ephemeral table has no time column, so the day comes from the job.
-- OFFSET 0 keeps one primary key lookup for each job, and never a scan of the full table.
EXECUTE IMMEDIATE FORMAT("""
  EXPORT DATA OPTIONS (
    uri = 'gs://BUCKET/verification_jobs_ephemeral/dt=%t/*.parquet',
    format = 'PARQUET',
    compression = 'ZSTD',
    overwrite = true
  ) AS
  SELECT * FROM EXTERNAL_QUERY('CONNECTION', '''
    SELECT ephemeral.id::text AS id, jobs.started_at, ephemeral.recompiled_creation_code,
      ephemeral.recompiled_runtime_code, ephemeral.onchain_creation_code,
      ephemeral.onchain_runtime_code, ephemeral.creation_transaction_hash
    FROM public.verification_jobs jobs
    CROSS JOIN LATERAL (
      SELECT * FROM public.verification_jobs_ephemeral WHERE id = jobs.id OFFSET 0
    ) ephemeral
    WHERE jobs.started_at >= '%s' AND jobs.started_at < '%s'
  ''')
""", day, day_start, day_end);
