-- migrate:up

-- Retention for verification jobs, see https://github.com/argotorg/sourcify/issues/3028
-- Functions, so that they also work without pg_cron. max_rows caps one call.
-- PL/pgSQL, so that Postgres plans the deletes with the real cutoff and limit.

-- The ephemeral rows go with the jobs through ON DELETE CASCADE.
CREATE OR REPLACE FUNCTION public.delete_expired_verification_jobs(retention interval DEFAULT '90 days'::interval, max_rows integer DEFAULT 100000) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.verification_jobs
  -- ctid = ANY(ARRAY(...)) fetches only these rows; id IN (...) can scan the full table
  WHERE ctid = ANY (ARRAY(
    SELECT ctid
    FROM public.verification_jobs
    WHERE started_at < NOW() - retention
    ORDER BY started_at
    LIMIT max_rows
  ));
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- 14 days is also the lifetime of the failed inputs in the debug bucket.
CREATE OR REPLACE FUNCTION public.delete_expired_verification_jobs_ephemeral(retention interval DEFAULT '14 days'::interval, max_rows integer DEFAULT 100000) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.verification_jobs_ephemeral
  WHERE ctid = ANY (ARRAY(
    SELECT ephemeral.ctid
    FROM public.verification_jobs_ephemeral ephemeral
    -- A scalar subquery, so that each job is a primary key lookup and never a table scan
    WHERE (
      SELECT started_at FROM public.verification_jobs WHERE id = ephemeral.id
    ) < NOW() - retention
    LIMIT max_rows
  ));
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- Jobs leave about 2% dead rows per day; the default waits for 20%.
ALTER TABLE public.verification_jobs SET (autovacuum_vacuum_scale_factor = 0.02);

-- Best effort, as for the reaper: without pg_cron the schedule is skipped.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron extension not available, verification-job cleanup will not be scheduled. Error: %', SQLERRM;
END
$$;

DO $$
BEGIN
    PERFORM cron.schedule(
        'delete-expired-verification-jobs',
        '23 * * * *',
        'SELECT public.delete_expired_verification_jobs_ephemeral(), public.delete_expired_verification_jobs();'
    );
    RAISE WARNING 'Scheduled verification-job cleanup (hourly, 90 days for jobs, 14 days for ephemeral rows)';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available, verification-job cleanup must be run manually. Error: %', SQLERRM;
END
$$;

-- migrate:down

DO $$
BEGIN
    PERFORM cron.unschedule('delete-expired-verification-jobs');
    RAISE WARNING 'Unscheduled verification-job cleanup';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available or job not found, continuing with cleanup. Error: %', SQLERRM;
END
$$;

ALTER TABLE public.verification_jobs RESET (autovacuum_vacuum_scale_factor);

DROP FUNCTION IF EXISTS public.delete_expired_verification_jobs_ephemeral(interval, integer);
DROP FUNCTION IF EXISTS public.delete_expired_verification_jobs(interval, integer);
