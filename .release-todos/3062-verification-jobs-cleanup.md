## before

Do each step on the staging database first, then on the production database. See #3028.

- Empty `verification_jobs_ephemeral` (192 GB on production). Run `SET lock_timeout = '5s'; TRUNCATE public.verification_jobs_ephemeral;` as the table owner. Jobs that failed in the last 14 days lose the bytecodes on their job page. Do this before the migrations: without it, the new cleanup job deletes the old bytecodes row by row, and that writes a lot of WAL.
- After the truncate on staging, check that the Datastream streams are healthy. The publication includes this table.
- Run `npm run migrate:up`. The first migration builds an index on the full `verification_jobs` table (about 80 GB on production) with `CREATE INDEX CONCURRENTLY`. It does not block writes, but it takes time.
- The second migration schedules the `pg_cron` job `delete-expired-verification-jobs`. From minute 23 of the next hour, each run deletes at most 100,000 jobs that are older than 90 days. The backlog on production (about 77M rows) is gone after about one month.

## after

- Check that the cleanup job runs: `SELECT status, return_message, start_time FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'delete-expired-verification-jobs') ORDER BY start_time DESC LIMIT 5;`
- Optional, to remove the backlog faster: at a quiet time, run `SELECT public.delete_expired_verification_jobs(max_rows => 500000);` again and again. Watch the disk and the Datastream freshness.
- Keep #3028 open. When `SELECT min(started_at) FROM verification_jobs;` gives a date in the last 91 days, the backlog is gone. Then run `pg_repack -k --wait-timeout 60 -t verification_jobs` to return the disk space, as for `sourcify_matches` in #2924.
