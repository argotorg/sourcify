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

## Docker

### Build

```bash
# From project root
docker build -f services/4byte/Dockerfile -t sourcify-4byte .
```

### Run

```bash
docker run -p 4445:80 \
  -e POSTGRES_HOST=your-db-host \
  -e POSTGRES_USER=your-db-user \
  -e POSTGRES_PASSWORD=your-db-password \
  sourcify-4byte
```
