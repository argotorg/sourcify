-- migrate:up

-- The nightly refresh of signature_stats reads all of compiled_contracts_signatures.
-- On production it hits the statement timeout, and on staging it runs the database
-- out of memory. The 4byte service now computes /stats from a daily BigQuery base
-- plus the new Postgres rows (see issue #3022).

-- Remove the scheduled job. pg_cron stays, because other jobs use it.
DO $$
BEGIN
    PERFORM cron.unschedule('refresh-signature-stats');
    RAISE WARNING 'Unscheduled signature stats refresh job';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available or job not found, continuing. Error: %', SQLERRM;
END
$$;

DROP MATERIALIZED VIEW IF EXISTS signature_stats;

-- migrate:down

CREATE MATERIALIZED VIEW signature_stats AS
SELECT
  signature_type::text,
  COUNT(DISTINCT signature_hash_32) AS count,
  now() AS refreshed_at
FROM compiled_contracts_signatures
GROUP BY signature_type

UNION ALL

SELECT
  'unknown'::text AS signature_type,
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
  'total'::text AS signature_type,
  COUNT(*) AS count,
  now() AS refreshed_at
FROM signatures;

CREATE UNIQUE INDEX signature_stats_type_idx ON signature_stats (signature_type);

DO $$
BEGIN
    PERFORM cron.schedule('refresh-signature-stats', '0 2 * * *', 'REFRESH MATERIALIZED VIEW signature_stats;');
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available, materialized view refresh must be done manually. Error: %', SQLERRM;
END
$$;
