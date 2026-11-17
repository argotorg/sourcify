-- migrate:up

-- A statement_timeout of the database user cancels a long run, and the next run tries the same rows again. See #3028.
DO $$
BEGIN
    PERFORM cron.schedule(
        'delete-expired-verification-jobs',
        '0 5 * * *',
        'SET statement_timeout = 0; SELECT public.delete_expired_verification_jobs(max_rows => 1000000);'
    );
    RAISE WARNING 'Scheduled verification-job cleanup without a statement timeout';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available, verification-job cleanup must be run manually. Error: %', SQLERRM;
END
$$;

-- migrate:down

DO $$
BEGIN
    PERFORM cron.schedule(
        'delete-expired-verification-jobs',
        '0 5 * * *',
        'SELECT public.delete_expired_verification_jobs(max_rows => 1000000);'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron not available, continuing. Error: %', SQLERRM;
END
$$;
