-- migrate:up

-- Fails verification jobs which never completed (e.g. the compiler subprocess
-- was OOM-killed or hung), releasing the chain+address lock that would
-- otherwise block resubmission indefinitely.
-- The query is backed by the partial index verification_jobs_in_progress_idx
-- added in 20260723090000. See https://github.com/argotorg/sourcify/issues/2880
--
-- Lives in a function rather than inline in the cron entry so that it is
-- installed on every database (the test database has no pg_cron, so the
-- schedule below is skipped there but the logic is still testable), and so
-- operators can reap manually with a single call that returns the count:
--   SELECT public.reap_stale_verification_jobs();
CREATE OR REPLACE FUNCTION public.reap_stale_verification_jobs(stale_threshold interval DEFAULT '3 hours'::interval) RETURNS integer
    LANGUAGE sql
    AS $$
  WITH reaped AS (
    UPDATE public.verification_jobs
    SET completed_at = NOW(),
        error_code = 'job_abandoned',
        error_id = gen_random_uuid(),
        verified_contract_id = NULL,
        compilation_time = NULL
    WHERE completed_at IS NULL
      AND started_at < NOW() - stale_threshold
    RETURNING 1
  )
  SELECT count(*)::integer FROM reaped;
$$;

-- Schedule the reaper with the same best-effort pg_cron pattern as
-- refresh-signature-stats: if the extension is unavailable the schedule is
-- skipped (a warning is raised) and the function must be called manually.

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    RAISE WARNING 'pg_cron extension enabled successfully';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron extension not available, stale verification-job reaper will not be scheduled. Error: %', SQLERRM;
END
$$;

-- Runs every 15 minutes against the function's default 3 hour threshold. The
-- `completed_at IS NULL` predicate keeps it idempotent and race-free. The
-- threshold is generous on purpose: the slowest legitimate compile observed is
-- ~13 min, so 3h will never reap a genuinely running job.
DO $$
BEGIN
    PERFORM cron.schedule(
        'reap-stale-verification-jobs',
        '*/15 * * * *',
        'SELECT public.reap_stale_verification_jobs();'
    );
    RAISE WARNING 'Scheduled stale verification-job reaper (every 15 min, 3h threshold)';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available, stale verification-job reaper must be run manually. Error: %', SQLERRM;
END
$$;

-- migrate:down

DO $$
BEGIN
    PERFORM cron.unschedule('reap-stale-verification-jobs');
    RAISE WARNING 'Unscheduled stale verification-job reaper';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available or job not found, continuing with cleanup. Error: %', SQLERRM;
END
$$;

DROP FUNCTION IF EXISTS public.reap_stale_verification_jobs(interval);
