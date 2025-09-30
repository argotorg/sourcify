# Sourcify Database

`sourcify-database` contains the database migrations for the PostgreSQL using [dbmate](https://github.com/amacneil/dbmate) to update its schema.

Sourcify's database is an extension of the [Verifier Alliance](https://verifieralliance.org) database with some modifications. The initial modifications are specified in the [20250722133557_sourcify.sql](./migrations/20250722133557_sourcify.sql) migration. In short, Sourcify allows contract verification without the creation bytecode and creation information such as the creation transaction hash. In addition, a table `sourcify_matches` is created to store the match type (full vs. partial) and the contract metadata in the database.

The migrations can be run to set up the Sourcify database.
A complete dump of the Sourcify database schema can be found in `./sourcify-database.sql`.

## Running the database

We use PostgreSQL 15.13 for the database. Higher versions should also work but are not tested.

### Run with Docker

For convenience, you can run the Postgres container in `docker-compose.yml` with

```bash
docker-compose up
```

## Database migrations

The Sourcify database migrations consist of all migrations of the Verifier Alliance [database-specs](https://github.com/verifier-alliance/database-specs), and any Sourcify modifications added in this repository inside `./migrations`.
The migrations should be used to update the live Sourcify production and staging databases, or any local testing database instance.

Schema changes should be made depending on the type of change:
If they are a Sourcify extension, they should be made inside this repo.
If they concern the Verifier Alliance schema, changes should be made in the Verifier Alliance [database-specs](https://github.com/verifier-alliance/database-specs) repository and then be pulled into this repository by updating the git submodule.
After updating the submodule, the schema dump `sourcify-database.sql` should be updated by running the migrations from this repository.

Any new migration should be capable of updating the live Sourcify staging and production databases.

### Prerequisites

Please initialize the Verifier Alliance [database-specs](https://github.com/verifier-alliance/database-specs) submodule before moving on with the migrations:

```bash
git submodule update --init
```

**Extensions**

- `pg_cron`: used to schedule the refresh of the signature stats materialized view. Make sure you [install the `pg_cron` extension](https://github.com/citusdata/pg_cron) and set the `cron.database_name` variable to the name of the database you are using.
  - If the `pg_cron` extension is not available, adding `pg_cron` and creating the cron job will be skipped in the migration.
  - In Google Cloud SQL, you can install the extension by setting the flag `cloudsql.enable_pg_cron` to `true`, and setting the `cron.database_name` flag to the name of the database you are using.
- `pg_trgm`: used to create the index on the `signatures` table.
- `pgcrypto`: used to create the `signature_type_enum` type.

dbmate is used to manage the database migrations.
A local installation of dbmate comes with `npm i`.
We will use npm scripts here for running dbmate in order to automatically include the Verifier Alliance migrations when necessary.

As a prerequisite for using dbmate, you should have a `.env` file configured with the database connection details.
Copy the `.env.template` file to `.env` and replace the database connection string in `DATABASE_URL`.
Please make sure to have the correct database configured before running any migration commands.

### See the status of the migrations

You can check which migrations have been applied to the database configured in `.env` by running:

```bash
npm run migrate:status
```

### Running the migrations

For running any pending migrations, you can execute:

```bash
npm run migrate:up
```

Note that this will also create the database configured in the `DATABASE_URL` if it does not exist yet.

### Roll back migrations

To reverse the most recently executed migration (one per call), run:

```bash
npm run migrate:rollback
```

### Adding a new migration

Please follow these steps:

1. Create a new migration file: `npm run migrate:new <migration_name>`
2. Add the required SQL for the schema change to the generated migration file (e.g., `./migrations/20250717103432_<migration_name>.sql`).
3. Apply the new migration to a local database: `npm run migrate:up`. `dbmate` automatically generates the updated `sourcify-database.sql` dump. There won't be an error if the dump cannot be generated. You can run `dbmate dump` to generate the dump manually or see the errors.
4. Commit both the new migration file and the updated `sourcify-database.sql` to the repository.

Important: Since the schema dump should be committed, ensure that the connected database does not contain any custom schema changes that are not part of the migrations.
If you are unsure whether your local database has custom schema changes, run the process against a fresh database.

## Migrating from the legacy repository (RepositoryV1) to the database

Following v2.0.0, Sourcify no longer uses the filesystem as its source of truth. To switch from the legacy repository to the new database, contracts need to be re-compiled and verified with a new Sourcify instance.

### Synchronization process

The synchronization process takes two steps, in the first one we are going to store all the contracts from the repov1 into `sourcify_sync`, a table used to keep track of the to-be-synced contracts. In the second step we are using the `sourcify_sync` table to re-verify all the contracts on a new sourcify instance marking every successful synced contract into `sourcify_sync` as `synced`.

> **Note**
> Use `npm run sourcify:database --  --help` for a full list of options and parameters

### 1. Import the repository in the `sourcify_sync` table

```
npm run sourcify:database import-repo /home/app/repository/contracts
```

### 2. Start synchronization from `sourcify_sync` to a Sourcify instance

```
npm run sourcify:database sync https://sourcify.dev/server /home/app/repository/contracts --  --chains 1,5,11155111 --limit 2 --start-from <timestamp> --until <timestamp>
```

### 3. Verifying deprecated chains

If there are chains that have been deprecated, their RPCs will not be available anymore so there's no way to fetch the deployment information for these contracts. We had verified these contracts so we might want to have these contracts regardless in our DB. To achieve that we need to put placeholders for the data related to the contract deployment, mostly on the `contract_deployments` table.

The script has a `--deprecated` flag that will take these chains and place their contracts in the database without actually "verifying" them i.e. not comparing the compiled vs onchain contract. In that case the script will submit the contracts to the `/private/verify-deprecated` endpoint of the Sourcify instance instead of `/verify`. This endpoint is activated if you pass the ` verifiedDeprecated: true` option in the Sourcify server config file.

The `contract_deployments` columns of such contracts will have these preset values:

```json
{
  "transactionHash": null,
  "blockNumber": -1,
  "transactionIndex": -1,
  "deployer": null,
  "contract_id": "<placeholder_contract_id>"
}
```

The "placeholder_contract_id" is the contract id for the "placeholder contract":

```json
{
  "creation_code_hash": "0xF2915DCA011E27647A7C8A50F7062915FDB4D4A1DE05D7333605DB231E5FC1F2", // in binary
  "runtime_code_hash": "0xF2915DCA011E27647A7C8A50F7062915FDB4D4A1DE05D7333605DB231E5FC1F2" // in binary
}
```

The "placeholder contract" has placeholder bytecode values. These hashes identify the placeholder bytecode that has the following `code` table entry:

```json
{
  "code_hash": "0xF2915DCA011E27647A7C8A50F7062915FDB4D4A1DE05D7333605DB231E5FC1F2", // in binary
  // Value below is hex formatted byte value of the string "!!!!!!!!!!! - chain was deprecated at the time of verification"
  "code": "0x2121212121212121212121202D20636861696E207761732064657072656361746564206174207468652074696D65206F6620766572696669636174696F6E", // in binary.
  "code_hash_keccak": "0xC65B76E29008C141EBA1F68E09231BD28016EABB565942EFC3EC242C47EF7CDE"
}
```
