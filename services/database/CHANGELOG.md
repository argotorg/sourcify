# Changelog for `sourcify-database`

## sourcify-database@2.5.4 - 2025-07-09

- update dependencies

## sourcify-database@2.5.3 - 2025-06-18

- Update readme and .env.dev for documentation
- Update packages

## sourcify-database@2.5.2 - 2025-05-20

- update dependencies

## sourcify-database@2.5.1 - 2025-05-06

- update dependencies

## sourcify-database@2.5.0 - 2025-04-30

- Add `error_data` column to `verification_jobs` table
- Add local-docker migration configuration
- Update dependencies

## sourcify-database@2.4.0 - 2025-04-09

- Add `updated_at` to `sourcify_matches`

## sourcify-database@2.3.0 - 2025-03-19

- Add verification_jobs tables
- Update the VerA schema
- Update dependencies

## sourcify-database@2.2.1 - 2025-02-18

- Make Dune namespace configurable

## sourcify-database@2.2.0 - 2025-02-06

- Add Dune upload script
- Reorganize database migrations

## sourcify-database@2.1.0 - 2025-01-08

- Add missing creation-tx backfill scripts


## sourcify-database@2.0.2 - 2024-12-11

- Update dependencies

## sourcify-database@2.0.1 - 2024-10-29

- Update packages

## sourcify-database@2.0.0 - 2024-10-14

- Update the Sourcify Database to incorporate the new Verifier Alliance Database schema
- Support for custom schema name in Postgres
- Add the script to migrate the database from v0 to v1

## sourcify-database@1.3.0 - 2024-08-29

- Added constraints for `compiled_contracts` table in migrations
- Updated the script:
  - Added `single-sync` command to send one contract
  - Added `import-creator-tx` to import all contracts with a creator-tx-hash.txt file. Needed for contracts that failed to verify with creation tx durign the sync
  - Refactor some parts
  - Change deprecated chains sync code

## sourcify-database@1.2.0 - 2024-07-25

- Update README on how to run the migrations
- add prod. env to the database migrations
- Add new migrations to accomodate the changes in the VerA database
- Update dependencies
- Update the script's import-repo command to insert the contracts read from the FS to the Database in batches instead of one-by-one


## sourcify-database@1.1.1 - 2024-05-14

- bump version

## sourcify-database@1.1.0 - 2024-04-23

- Add session table to migrations 

## sourcify-database@1.0.3 - 2024-04-04

- Add schema to support postgresql based session (commented)

## sourcify-database@1.0.2 - 2024-03-14

- Fix `fsevents` to the `optionalDependencies` for Linux builds.

## sourcify-database@1.0.1 - 2024-02-26

- Fix migration scripts

## sourcify-database@1.0.0 - 2024-02-22

- Initial commit
