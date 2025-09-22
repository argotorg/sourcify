-- migrate:up

-- Enable pg_cron extension for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create materialized view for signature statistics
-- This pre-computes the counts that the /stats endpoint needs
CREATE MATERIALIZED VIEW signature_stats AS
SELECT
  signature_type,
  COUNT(DISTINCT signature_hash_32) AS count
FROM compiled_contracts_signatures
GROUP BY signature_type;

-- Add index for fast lookups
CREATE UNIQUE INDEX signature_stats_type_idx ON signature_stats (signature_type);

-- Create function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_signature_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW signature_stats;
  -- Log the refresh for monitoring
  RAISE NOTICE 'Signature stats materialized view refreshed at %', now();
END;
$$ LANGUAGE plpgsql;

-- Schedule daily refresh at 2 AM UTC
-- This keeps stats current without impacting real-time performance
SELECT cron.schedule('refresh-signature-stats', '0 2 * * *', 'SELECT refresh_signature_stats();');

-- migrate:down

-- Remove scheduled job
SELECT cron.unschedule('refresh-signature-stats');

-- Drop function and materialized view
DROP FUNCTION IF EXISTS refresh_signature_stats();
DROP MATERIALIZED VIEW IF EXISTS signature_stats;