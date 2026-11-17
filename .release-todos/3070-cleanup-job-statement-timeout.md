## before

- Run `npm run migrate:up` on the staging database, then on the production database. The migration schedules the `pg_cron` job `delete-expired-verification-jobs` again, with `SET statement_timeout = 0;` in front of its command. See #3028.
- On production the job has this command since 2026-11-17, set by hand with `cron.alter_job`. So the migration changes nothing there. The reason for the change: the role `sourcify` has a `statement_timeout` of 290 seconds on production, and that cancels a full run.
- The migration also sets the schedule of the job to `0 5 * * *` and `max_rows` to 1,000,000 again. If you changed them with `cron.alter_job`, set them again after the migration.

## after

- Check the command of the job: `SELECT schedule, command FROM cron.job WHERE jobname = 'delete-expired-verification-jobs';`
