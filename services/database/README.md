# Sourcify Database

`sourcify-database` contains the database migrations for the PostgreSQL using `db-migrate` to update its schema.

Sourcify's database is an extension of the [Verifier Alliance](https://verifieralliance.org) database with some modifications. The modifications are specified in the [20231109160023-sourcify.js](./migrations/20231109160023-sourcify.js) migration. In short, Sourcify allows contract verification without the creation bytecode and creation information such as the creation transaction hash. In addition, a table `sourcify_matches` is created to store the match type (full vs. partial) and the contract metadata in the database.

The migrations can be run to set up the Sourcify database.

## Running the database

### Run with Docker

For convenience, you can run the Postgres container in `docker-compose.yml` with
```bash
docker-compose up
```

## Database migrations

### Prerequisites

Please initialize the [Verifier Alliance database-specs](https://github.com/verifier-alliance/database-specs) submodule before moving on with the migrations:

```
git submodule update --init
```

### Running the migrations

- Copy paste `.env.template` in `.env` and set the variables.
- Run `npm run migrate:up` to update the database to the latest version. This will run the `dev` config in [database.json](./database.json) with `localhost`. To run the migrations in production with `POSTGRES_HOST` use `npm run migrate:up -- --env production`

### Reset the database

- Run `npm run migrate:reset` to reverse all the executed migrations

### Creating a change to the schema with migrations

- Run `npm run migrate:create` to create a new database migration, a new file under `migrations/` will appear, use that file to alter the database.

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
