# sourcify-server

Sourcify's server for verifying Solidity and Vyper smart contracts.

The server uses [lib-sourcify](https://github.com/ethereum/sourcify/tree/main/packages/lib-sourcify) under the hood for contract verification logic. It provides REST API endpoints for users to submit new contracts for verification or retrieve verified contracts. The data is stored in a PostgreSQL database.

## Quick Start with Docker Compose

There is a docker compose file which makes running the latest published Sourcify server image easy.

Keep in mind this is not recommended for production use. You should run a production instance of a Postgres database, add your user, run the migrations, and then run the server.

You should change the chains you want to support in the `sourcify-chains-example.json` file (see [Chains Config](#chains-config)) and the server's `.env.docker` file with the required and optional values (see `.env.dev` file).

```bash
cd ../.. ## Run from the project root
docker compose -f ./services/server/docker-compose.yml up
```

The setup starts a postgres database, runs the needed database migrations, builds and starts the Sourcify server with port 5555 exposed to your local machine and just supporting Ethereum Mainnet, and local testnets (chainIds: 1, 1337, 31337) as defined in the `sourcify-chains-example.json` file.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/en/) (recommended v22)
- Postgres 16 (or Docker)

### Local Development Setup

First head to the project root directory and run the following commands:

```bash
cd ../..
```

### 1. Install dependencies

```bash
npm install
```

### 2. Build the monorepo's packages

```bash
npx lerna run build
```

### 3. Pull the database schema

Pull the database schema from the [Verifier Alliance](https://github.com/verifier-alliance/database-specs) repository. It's the base for the Sourcify database.

```bash
git submodule update --init --recursive
```

### 4. Spin up a PostgreSQL database

Here you can run a Postgres container with Docker or a Postgres instance yourself. For production, you should run a Postgres instance and then add your own user.

#### Option 1: Run a Postgres container

Go to the `services/database`

```bash
cd services/database
```

Copy the `.env.template` file into a file named `.env`.

```bash
cp .env.template .env
```

Change values if they are different for your Postgres instance or use those defaults.

Run Postgres with docker compose (note that this will not have a `postgres` root user).

```bash
docker compose up -d
```

#### Option 2: Run a Postgres instance

You can run a Postgres instance on your local machine or a cloud instance and enter the credentials in the `.env` file when running the migrations below and later in the server's `.env` file.

### 5. Run the migrations

Go to the `services/database` if you haven't already.

```bash
cd services/database
```

Run the migrations. Migrations with `--env dev` will write the database schema for your instance using the credentials from the `serivces/database/.env` file. See `database.json` for other environments.

```bash
npm run migrate:up -- --env dev
```

If you get a DB authentication error, double check you don't have an existing Postgres instance. If so either stop or change the values in the `.env` file. If you were using docker, make sure the container and the container's volume is deleted for a fresh new instance.

### 6. Set env vars for the server

Go to the `services/server` directory to set env vars.

```bash
cd ../server
```

Copy the `.env.dev` file into a file named `.env`.

```bash
cp .env.dev .env
```

The `.env.dev` contains the default database credentials for the Sourcify database. You should change the values to match your Postgres instance.

You can run without filling the optional values in `.env` but to connect to some RPCs you need to add API keys as env vars. Check the `sourcify-chains-default.json` file if the chain you are interested in has an authenticated RPC or create your own `sourcify-chains.json` file. See [Chains Config](#chains-config) for more details.

### 7. Set supported chains

Copy the example chains config file as the main chains config file. You can change the chains you want to support here.

If there is a `src/sourcify-chains.json` file already, the server will use it. Otherwise, it will use the `src/sourcify-chains-default.json` file.

```bash
cp src/sourcify-chains-example.json src/sourcify-chains.json
```

### 8. Build the server

Build the server to generate the chains config file in `dist/sourcify-chains.json`

```bash
npm run build
```

### 9. Start the server

```bash
npm start
```

### 10. Test the server

```bash
curl http://localhost:5555/health
```

You should see `Alive and kicking!` in the response.

## Config

### Server Config

The server config is defined in [`src/config/default.js`](src/config/default.js).

To override the default config, you can create a `local.js` file and override the default config. The parameters are overridden one by one, so you only need to override the parameters you want to change.

Note that you need to set the read storage option to `RWStorageIdentifiers.SourcifyDatabase` and run a PostgreSQL database to make API v2 available. See [Database](#database).

Once you've written your own config, you must build the server again for changes to take effect:

```
npx lerna run build
```

Alternatively, if you are running in a deployment you can pass the `NODE_CONFIG_ENV` name as the config file name and it will take precedence. For example, if you are running in a `NODE_CONFIG_ENV=staging` environment, you can create a [`config/staging.js`](src/config/staging.js) file and it will be used instead of the default config. Local takes precedence over `NODE_CONFIG_ENV`. The file precedence is defined in [node-config package](https://github.com/node-config/node-config/wiki/Configuration-Files#multi-instance-deployments).

<details>
  <summary><b>Full list of config options</b></summary>

<!-- prettier-ignore-start -->
```js
const {
  WStorageIdentifiers,
  RWStorageIdentifiers,
} = require("../server/services/storageServices/identifiers");

module.exports = {
  serverUrl: "http://sourcify.dev/server", // The public URL of the server
  server: {
    port: 5555, // The port the server will run on
    maxFileSize: 30 * 1024 * 1024, // The maximum uploaded file size in bytes
  },
  // The storage services where the verified contract be saved and read from
  storage: {
    // read option will be the "source of truth" where the contracts read from for the API requests.
    read: RWStorageIdentifiers.SourcifyDatabase,
    // User request will NOT fail if saving to these fail, but only log a warning
    writeOrWarn: [
      WStorageIdentifiers.AllianceDatabase,
      RWStorageIdentifiers.RepositoryV1,
    ],
    // The user request will fail if saving to these fail
    writeOrErr: [
      WStorageIdentifiers.RepositoryV2,
      RWStorageIdentifiers.SourcifyDatabase,
    ],
  },
  repositoryV1: {
    path: "/tmp/sourcify/repository", // The path to the repositoryV1 on the filesystem
  },
  repositoryV2: {
    path: "/tmp/sourcify/repositoryV2", // The path to the repositoryV2 on the filesystem
  },
  solcRepo: "/tmp/solc-bin/linux-amd64", // The path to the solc binaries on the filesystem
  solJsonRepo: "/tmp/solc-bin/soljson", // The path to the solJson binaries on the filesystem
  vyperRepo: "/tmp/vyper-bin/linux-amd64", // The path to the vyper binaries on the filesystem
  session: { // deprecated, not part of API v2
    secret: process.env.SESSION_SECRET || "CHANGE_ME", // The secret used to sign the session cookie
    maxAge: 12 * 60 * 60 * 1000, // The maximum age of the session in milliseconds
    secure: false,
    // Where to save session data. Options: "memory" | "database"
    // - "memory": Sessions stored in server memory. Only use for testing/local development.
    // Sessions are lost when server restarts.
    // - "database": Sessions stored in PostgreSQL. Recommended for production.
    // Requires database setup (see Database section) and uses the `session` table.
    storeType: "memory",
  },
  // If true, downloads all production version compilers and saves them.
  initCompilers: false,
  // The origins that are allowed to access the server, regex allowed
  corsAllowedOrigins: [/^https?:\/\/(?:.+\.)?sourcify.dev$/],
  // verify-deprecated endpoint used in services/database/scripts.mjs. Used when recreating the DB with deprecated chains that don't have an RPC.
  verifyDeprecated: false,
};
```
<!-- prettier-ignore-end -->

</details>

### Chains Config

The chains supported by the Sourcify server are defined in `src/sourcify-chains-default.json`.

To support a different set of chains, you can create a `src/sourcify-chains.json` file and completely override the default chains.

A full example of a chain entry is as follows:

```json
{
  // the chain id
  "1": {
    "sourcifyName": "Ethereum Mainnet", // required
    "supported": true, // required
    // optional
    "etherscanApi": {
      "supported": true, // required
      "apiKeyEnvName": "ETHERSCAN_API_KEY" // the name of the environment variable holding the api key
    },
    // optional
    "fetchContractCreationTxUsing": {
      // How to find the transaction hash that created the contract
      "etherscanApi": true, // if supported by the new etherscan api. Need to provide the etherscanApi config
      "blockscoutApi": {
        // blockscout v2 instances have an api endpoint for this
        "url": "https://gnosis.blockscout.com/"
      },
      "blockscoutScrape": {
        // scraping from old (server-side rendered) blockscout ui
        "url": "https://scan.pulsechain.com/"
      },
      "avalancheApi": true // avalanche subnets at glacier-api.avax.network have an api endpoint for this
    },
    // optional. If not provided, the default rpc will be the ones from src/chains.json. This file is manually synced from chainid.network/chains.json.
    "rpc": [
      "https://rpc.sepolia.io", // can be a simple url string
      {
        "type": "FetchRequest", // ethers.js FetchRequest for header authenticated RPCs
        "url": "https://rpc.mainnet.ethpandaops.io",
        "headers": [
          {
            "headerName": "CF-Access-Client-Id",
            "headerEnvName": "CF_ACCESS_CLIENT_ID"
          },
          {
            "headerName": "CF-Access-Client-Secret",
            "headerEnvName": "CF_ACCESS_CLIENT_SECRET"
          }
        ]
      },
      {
        "type": "APIKeyRPC", // Alchemy RPCs, or any other RPC that requires an API key. ${API_KEY} will be replaced with the value of the env var.
        "url": "https://eth-mainnet.alchemyapi.io/v2/{API_KEY}",
        "apiKeyEnvName": "ALCHEMY_API_KEY"
      }
    ]
  }
}
```

### Choosing the storage backend

There are two types of storages: `RWStorageIdentifiers` (Read and Write) and `WStorageIdentifiers` (Write only). These are the possible options:

- ~~`RWStorageIdentifiers.RepositoryV1`~~ (deprecated) - the legacy repository that saves the source files and metadata as is inside a filesystem. A file system has many limitations and newer versions of the sourcify-server keeps it for backwards compatibility. If used as the `read` option, the `/v2` API endpoints won't be available. We don't recommend using this option.
- `WStorageIdentifiers.RepositoryV2` - a filesystem for serving source files and metadata.json files on IPFS. Since pinning files on IPFS is done over a file system, Sourcify saves these files here. This repository does not save source file names as given in the metadata file (e.g. `contracts/MyContract.sol`) but saves each file with their keccak256 hash. This is done to avoid file name issues, as source file names can be arbitrary strings.

- `WStorageIdentifiers.AllianceDatabase` - To write the verified contracts to the [Verifier Alliance](https://verifieralliance.org) database (optional)
- `RWStorageIdentifiers.SourcifyDatabase` - the PostgreSQL database that is an extension of the Verifier Alliance database. Required for API v2. See [Database](#database).

`RWStorageIdentifiers` can both be used as a source of truth (`read`) and store (`writeOr...`) the verified contracts. `WStorageIdentifiers` can only store (write) verified contracts. For instance, Sourcify can write to the [Verifier Alliance](https://verifieralliance.org) whenever it receives a verified contract, but this can't be the source of truth for the Sourcify APIs.

If you have an instance running on the legacy filesystem storage backend, see [docs](https://docs.sourcify.dev/docs/database-migration/) for migration instructions.

The following is an example of the storage config:

```js
  // The storage services where the verified contract will be saved and read from
  storage: {
    // read option will be the "source of truth" where the contracts read from for the API requests.
    read: RWStorageIdentifiers.SourcifyDatabase,
    // The verificationjob will NOT fail if saving to these fail, but only log a warning
    writeOrWarn: [
      WStorageIdentifiers.AllianceDatabase,
    ],
    // The verification job will fail if saving to these fail
    writeOrErr: [
      WStorageIdentifiers.RepositoryV2,
      RWStorageIdentifiers.SourcifyDatabase,
    ],
  },
```

## Database

Sourcify runs on a PostgreSQL database. The database schema is defined in the [services/database](../database/) and available as database migrations. To use the database, you need to run a PostgreSQL database and run the migrations to define its schema.

See the [Database docs](https://docs.sourcify.dev/docs/repository/sourcify-database/) for more information about the schema.

### Setup

First, run a PostgreSQL database. You can use a local instance or a cloud instance. You can use the docker compose file in the [services/database](../database/) to run a local instance but this isn't recommended for production use.

Then, head to the [services/database](../database/) directory and input the credentials in the `.env` file.

```bash
cd ../database
cp .env.template .env
```

Fill in the `POSTGRES_XXXXX` environment variables with the credentials for your database.

The migrations have different setups for different environments in the `database.json` file. Run the migrations to create the schema:

```bash
npm run migrate:up -- --env production
```

Additionally you need to set up the credentials in the server's `.env` file. See [Server Config](#server-config) for more details.

## Docker

The images are published in the [Github Container Registry](https://github.com/ethereum/sourcify/pkgs/container/sourcify%2Fserver)

### Building the image

If you want to build the image yourself, the builds need to be run from the project root context, e.g.:

```bash
cd sourcify/ && docker build -f services/server/Dockerfile .
```

### Running the image directly

You can run the server using Docker and pass in a custom `sourcify-chains.json` (see above [Chains Config](#chains-config)) and `local.js` (see above [Server Config](#server-config)) config file.

Also set up the environment variables in the `.env` file. You can see the list of required environment variables in the `.env.dev` file. Pass it with the `--env-file` flag or use the `--env` flag to pass individual environment variables.

```bash
$ docker pull ghcr.io/ethereum/sourcify/server:latest
$ docker run \
  -p 5555:5555 \
  -v path/to/custom/sourcify-chains.json:/home/app/services/server/dist/sourcify-chains.json \
  -v path/to/custom/config.js:/home/app/services/server/dist/config/local.js \
  --env-file path/to/your-server/.env \
  ghcr.io/ethereum/sourcify/server:latest
```

Keep in mind the default host for DB in the .env is "localhost" and the default port is 5432. If you're running your server and the database in Docker, you need to establish a network connection between the two over a [Docker network](https://docs.docker.com/network/).

### Connecting to a node on the host

The following feature is only supported on Docker Desktop for Mac and Windows: If you are running an RPC server for a chain on the Docker host, you can have your Sourcify container connect to it by using `host.docker.internal` as the hostname (or `host.containers.internal` if using Podman instead of Docker). For example, if the RPC server is accessible on the host at `http://localhost:8545`, configure the RPC's URL in `sourcify-chains.json` as `http://host.docker.internal:8545`.

## Logging

By default the server logs `info` level when `NODE_ENV=production` and `debug` otherwise.

It is possible to set a custom logging level with the environment variable `NODE_LOG_LEVEL` when starting the server.

Another possibility is the authenticated endpoint `/private/change-log-level`. Sending a `POST` with `{ "level": "debug" }` will set the new logging level dynamically, given the `SOURCIFY_PRIVATE_TOKEN` matches the header `authorization = Bearer <token-value>`. This is particularly useful in production for debugging and tracing purposes.
