## before

- Run `npm run migrate:up` on the staging database (drops `idx_code_code_first_75`; the drop is instant)
- Run `npm run migrate:up` on the production database (the drop is instant; frees ~1.1 GB)
- Note: after this migration, a rollback to a pre-4.0.0 server needs `npm run migrate:down` first. The recreation scans the whole `code` table and takes several minutes on production.
