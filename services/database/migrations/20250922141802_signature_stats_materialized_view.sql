-- migrate:up

-- Enable pg_cron extension for scheduled tasks (gracefully handle if not available)
-- By default this only runs on the database "postgres" but you can set the cron.database_name variable in the postgresql.conf to a different database.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    RAISE WARNING 'pg_cron extension enabled successfully';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron extension not available, continuing without scheduled refresh. Error: %', SQLERRM;
END
$$;

-- Create materialized view for signature statistics
-- This pre-computes the counts that the /stats endpoint needs
-- Includes both signatures with types (from compiled_contracts_signatures) and unknown signatures
CREATE MATERIALIZED VIEW signature_stats AS
SELECT
  signature_type,
  COUNT(DISTINCT signature_hash_32) AS count,
  now() AS refreshed_at
FROM compiled_contracts_signatures
GROUP BY signature_type

UNION ALL

SELECT
  'unknown' AS signature_type,
  COUNT(*) AS count,
  now() AS refreshed_at
FROM signatures s
WHERE NOT EXISTS (
  SELECT 1
  FROM compiled_contracts_signatures ccs
  WHERE ccs.signature_hash_32 = s.signature_hash_32
)

UNION ALL

SELECT
  'total' AS signature_type,
  COUNT(*) AS count,
  now() AS refreshed_at
FROM signatures;

-- Add index for fast lookups
CREATE UNIQUE INDEX signature_stats_type_idx ON signature_stats (signature_type);

-- Schedule daily refresh at 2 AM UTC (only if pg_cron is available)
-- This keeps stats current without impacting real-time performance
DO $$
BEGIN
    PERFORM cron.schedule('refresh-signature-stats', '0 2 * * *', 'REFRESH MATERIALIZED VIEW signature_stats;');
    RAISE WARNING 'Scheduled daily refresh of signature stats at 2 AM UTC';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available, materialized view refresh must be done manually. Error: %', SQLERRM;
END
$$;

-- migrate:down

-- Remove scheduled job (gracefully handle if pg_cron not available)
DO $$
BEGIN
    PERFORM cron.unschedule('refresh-signature-stats');
    RAISE WARNING 'Unscheduled signature stats refresh job';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available or job not found, continuing with cleanup. Error: %', SQLERRM;
END
$$;

-- Drop materialized view
DROP MATERIALIZED VIEW IF EXISTS signature_stats;