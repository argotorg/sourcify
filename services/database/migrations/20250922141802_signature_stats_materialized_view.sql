-- migrate:up

-- Enable pg_cron extension for scheduled tasks (gracefully handle if not available)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    RAISE NOTICE 'pg_cron extension enabled successfully';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron extension not available, continuing without scheduled refresh';
END
$$;

-- Create materialized view for signature statistics
-- This pre-computes the counts that the /stats endpoint needs
CREATE MATERIALIZED VIEW signature_stats AS
SELECT
  signature_type,
  COUNT(DISTINCT signature_hash_32) AS count,
  now() AS created_at,
  now() AS refreshed_at
FROM compiled_contracts_signatures
GROUP BY signature_type;

-- Add index for fast lookups
CREATE UNIQUE INDEX signature_stats_type_idx ON signature_stats (signature_type);

-- Create function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_signature_stats()
RETURNS void AS $$
BEGIN
  -- Refresh materialized view with updated timestamps
  REFRESH MATERIALIZED VIEW signature_stats;

  -- Update refreshed_at timestamp for all rows
  UPDATE signature_stats SET refreshed_at = now();

  -- Log the refresh for monitoring
  RAISE NOTICE 'Signature stats materialized view refreshed at %', now();
END;
$$ LANGUAGE plpgsql;

-- Schedule daily refresh at 2 AM UTC (only if pg_cron is available)
-- This keeps stats current without impacting real-time performance
DO $$
BEGIN
    PERFORM cron.schedule('refresh-signature-stats', '0 2 * * *', 'SELECT refresh_signature_stats();');
    RAISE NOTICE 'Scheduled daily refresh of signature stats at 2 AM UTC';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available, materialized view refresh must be done manually';
END
$$;

-- migrate:down

-- Remove scheduled job (gracefully handle if pg_cron not available)
DO $$
BEGIN
    PERFORM cron.unschedule('refresh-signature-stats');
    RAISE NOTICE 'Unscheduled signature stats refresh job';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available or job not found, continuing with cleanup';
END
$$;

-- Drop function and materialized view
DROP FUNCTION IF EXISTS refresh_signature_stats();
DROP MATERIALIZED VIEW IF EXISTS signature_stats;