## before

Do each step on the staging database first, then on the production database. See #3028.

- Run `npm run migrate:up`. The first migration builds an index on the full `verification_jobs` table (about 80 GB on production) with `CREATE INDEX CONCURRENTLY`. It does not block writes, but it takes time.
- This release deletes nothing. The second migration installs two cleanup functions, but nothing calls them.

## after

- Keep #3028 open. The archive of both job tables comes first. The `TRUNCATE` of the old bytecodes, the schedule of the cleanup and `pg_repack` come in a second PR, when the archive works.
