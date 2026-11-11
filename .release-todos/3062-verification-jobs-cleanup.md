## before

Do each step on the staging database first, then on the production database. See #3028.

- Keep a copy of `verification_jobs` in BigQuery before the cleanup deletes rows. Check first that the publication has the table: `SELECT 1 FROM pg_publication_tables WHERE pubname = 'sourcify_publication' AND tablename = 'verification_jobs';` must give one row. Then, in Datastream, add `public.verification_jobs` to the stream `sourcify-staging-pg-bq-stream`, and later to `sourcify-prod-pg-bq-stream`. On staging the table is in the exclude list of the stream: remove it there and add it to the include list. These streams are append-only: a delete in Postgres adds a `DELETE` row in BigQuery, and the older rows stay. The datasets `sourcify_staging` and `sourcify` are public, so the new table `public_verification_jobs` is public too.
- Wait for the backfill (about 100M rows on production). On the Objects tab of the stream, the backfill status of `public.verification_jobs` must be Completed. If the backfill does not start by itself, start it there with "Initiate backfill". Do not continue before it is complete: the cleanup job deletes rows for ever.
- Empty `verification_jobs_ephemeral` (192 GB on production). Run `SET lock_timeout = '5s'; TRUNCATE public.verification_jobs_ephemeral;` as the table owner. Jobs that failed in the last 14 days lose the bytecodes on their job page. Do this before the migrations: without it, the new cleanup job deletes the old bytecodes row by row, and that writes a lot of WAL.
- Run `npm run migrate:up`. The first migration builds an index on the full `verification_jobs` table (about 80 GB on production) with `CREATE INDEX CONCURRENTLY`. It does not block writes, but it takes time.
- The second migration schedules the `pg_cron` job `delete-expired-verification-jobs`. From minute 23 of the next hour, each run deletes at most 100,000 jobs that are older than 90 days. The backlog on production (about 77M rows) is gone after about one month.

## after

- Check that the cleanup job runs: `SELECT status, return_message, start_time FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'delete-expired-verification-jobs') ORDER BY start_time DESC LIMIT 5;`
- Optional, to remove the backlog faster: at a quiet time, run `SELECT public.delete_expired_verification_jobs(max_rows => 500000);` again and again. Each deleted job is one event in the stream, so watch the disk and the Datastream freshness.
- Keep #3028 open. When `SELECT min(started_at) FROM verification_jobs;` gives a date in the last 91 days, the backlog is gone. Then run `pg_repack -k --wait-timeout 60 -t verification_jobs` to return the disk space, as for `sourcify_matches` in #2924.
