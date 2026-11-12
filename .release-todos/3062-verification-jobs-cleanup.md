## before

Do each step on the staging database first, then on the production database. See #3028.

- Do not release before the archive of this database is complete. The cleanup deletes rows for ever. Three conditions: the scheduled query `verification-jobs-archive-staging` (or `-production`) runs each day (see "Archive of the verification job tables" in `services/database/README.md`), the backfill of all older days is complete, and the row counts of each day in the bucket are equal to Postgres.
- The archive needs the index `verification_jobs_started_at_idx`, so it was built by hand before this release. Check it: `SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.verification_jobs_started_at_idx'::regclass;` must give `t`. Then the first migration does nothing. If the query gives `f`, run `DROP INDEX CONCURRENTLY verification_jobs_started_at_idx;` first. If the index does not exist, the first migration builds it on the full table (about 80 GB on production) with `CREATE INDEX CONCURRENTLY`. That does not block writes, but it takes time.
- Run `npm run migrate:up`. The second migration schedules the `pg_cron` job `delete-expired-verification-jobs`. From minute 23 of the next hour, each run deletes at most 100,000 jobs that are older than 90 days, and at most 100,000 rows of `verification_jobs_ephemeral` that are older than 30 days. The backlog of jobs on production (about 77M rows) is gone after about one month.

## after

- Check that the cleanup job runs: `SELECT status, return_message, start_time FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'delete-expired-verification-jobs') ORDER BY start_time DESC LIMIT 5;`
- Watch the disk of the database in the first days. The deletes of the old bytecodes (192 GB on production) write a lot of WAL.
- Keep #3028 open. When `SELECT min(started_at) FROM verification_jobs;` gives a date in the last 91 days, the backlog is gone. Then run `pg_repack -k --wait-timeout 60 -t verification_jobs -t verification_jobs_ephemeral` to return the disk space, as for `sourcify_matches` in #2924.
