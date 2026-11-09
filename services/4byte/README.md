# Sourcify 4byte Service

A standalone service for serving Ethereum function, event, and error signatures. Makes use of Sourcify's verified contracts database's signature collection (See [Sourcify Database](https://github.com/argotorg/sourcify/tree/master/services/database)).

The API is backwards compatible with the [openchain.xyz](https://openchain.xyz/) API.

## Overview

## Features

- **Signature Lookup**: Find signatures by their 4-byte or 32-byte hashes e.g. `0xa9059cbb`
- **Signature Search**: Search signatures by text patterns e.g. `transfer(address,uint256)`
- **Statistics**: Get signature counts and metadata
- **Multi-type Support**: Functions, events, and error signatures
- **Filtering**: Optional filtering for canonical signatures

## API Endpoints

Refer to the [OpenAPI specification](./src/openapi.yaml) for the API endpoints and their usage.

The docs are available at runtime at `/api-docs` as a Swagger UI website.

## Development

### Prerequisites

- Node.js 22
- PostgreSQL database with Sourcify schema (See [Sourcify Database](https://github.com/argotorg/sourcify/tree/master/services/database))

### Setup

```bash
# Install dependencies
npm install

# Build the service
npm run build

# Run tests
npm run test-local

# Start development server
npm run dev
```

### Environment Variables

Check out the `.env.example` file for the required environment variables.

### Signature stats

`GET /signature-database/v1/stats` does not count all signatures in Postgres, because a count by type reads all rows of `compiled_contracts_signatures`. Instead:

1. Once a day, a BigQuery scheduled query ([`bigquery/signature-stats-base.sql`](./bigquery/signature-stats-base.sql)) counts all signatures with `created_at <= t0` in the BigQuery mirror of the database. It writes the counts to a JSON file in the private bucket `sourcify-signature-stats`.
2. The service reads the file from `SIGNATURE_STATS_BASE_URL` at start and every 10 minutes. For a `gs://bucket/object` URL, it reads the file as the service account of the Cloud Run service (a token from the metadata server). An `https://` URL is read without authentication.
3. The service keeps the counts in memory. At start, and when it gets a newer file, it adds the signatures with `created_at > t0` from Postgres. This first count can take some seconds (about 8 seconds for one day on production).
4. After that, it adds the new signatures of each minute. Each count window ends at a whole minute and skips the newest minute, because rows can commit late. So all instances count the same rows and give the same numbers.
5. A request to `/stats` gives the counts from memory. A request waits only if the timers did not run: after a start, or when Cloud Run throttles the CPU between requests. Then the request reads the file (if 10 minutes have passed) and counts the missing minutes before it replies.

The numbers are approximate. A signature that is already in the database and gets a type later (an imported signature that a verified contract uses) keeps its old type until the next base.

If the service has no file, or the `t0` of the counts is older than `SIGNATURE_STATS_BASE_MAX_AGE_HOURS` (default 48 hours), the `function`, `event`, `error` and `unknown` counts are `null`. This also applies to a running instance whose base gets old, so all instances give the same result. `total` is then the last total, or one full count in Postgres at start, plus the new signatures of each minute.

## Docker

### Build

```bash
# From project root
docker build -f services/4byte/Dockerfile -t sourcify-4byte .
```

### Run

```bash
docker run -p 4445:80 \
  -e FOURBYTES_POSTGRES_HOST=your-db-host \
  -e FOURBYTES_POSTGRES_USER=your-db-user \
  -e FOURBYTES_POSTGRES_PASSWORD=your-db-password \
  sourcify-4byte
```
