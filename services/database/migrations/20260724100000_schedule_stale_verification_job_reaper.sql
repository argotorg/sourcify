-- migrate:up

-- Schedule a periodic reaper that fails verification jobs which never completed
-- (e.g. the compiler subprocess was OOM-killed or hung), releasing the
-- chain+address lock that would otherwise block resubmission indefinitely.
-- The reaper query is backed by the partial index verification_jobs_in_progress_idx
-- added in 20260723090000. See https://github.com/argotorg/sourcify/issues/2880
--
-- Uses the same best-effort pg_cron pattern as refresh-signature-stats: if the
-- extension is unavailable the schedule is skipped (a warning is raised) and
-- jobs can be reaped manually by running the same UPDATE.

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    RAISE WARNING 'pg_cron extension enabled successfully';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron extension not available, stale verification-job reaper will not be scheduled. Error: %', SQLERRM;
END
$$;

-- Runs every 15 minutes and marks any in-progress job older than 3 hours as
-- abandoned. The `completed_at IS NULL` predicate keeps it idempotent and
-- race-free. The threshold is generous on purpose: the slowest legitimate
-- compile observed is ~13 min, so 3h will never reap a genuinely running job.
DO $$
BEGIN
    PERFORM cron.schedule(
        'reap-stale-verification-jobs',
        '*/15 * * * *',
        $job$
        UPDATE public.verification_jobs
        SET completed_at = NOW(),
            error_code = 'job_abandoned',
            error_id = gen_random_uuid(),
            verified_contract_id = NULL,
            compilation_time = NULL
        WHERE completed_at IS NULL
          AND started_at < NOW() - INTERVAL '3 hours';
        $job$
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
