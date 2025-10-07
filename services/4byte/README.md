# Sourcify 4byte Service

A standalone service that exposes Sourcify's signature database endpoints for Ethereum function, event, and error signatures.

## Overview

The 4byte service provides API endpoints to lookup and search contract signatures from Sourcify's verified contracts database. It serves as a signature database similar to 4byte.directory but populated from Sourcify's verified contract collection.

## Features

- **Signature Lookup**: Find signatures by their 4-byte or 32-byte hashes
- **Signature Search**: Search signatures by text patterns
- **Statistics**: Get signature counts and metadata
- **Multi-type Support**: Functions, events, and error signatures
- **Filtering**: Optional filtering for canonical signatures

## API Endpoints

### GET `/signature-database/v1/lookup`

Lookup signatures by hash.

**Query Parameters:**

- `function` - 4-byte or 32-byte hash for function signatures
- `event` - 32-byte hash for event signatures
- `error` - 4-byte hash for error signatures
- `filter` - Boolean to enable/disable canonical filtering (default: true)

### GET `/signature-database/v1/search`

Search signatures by text pattern.

**Query Parameters:**

- `query` - Text pattern to search for
- `filter` - Boolean to enable/disable canonical filtering (default: true)

### GET `/signature-database/v1/stats`

Get signature database statistics.

## Development

### Prerequisites

- Node.js 22.5.1+
- PostgreSQL database with Sourcify schema

### Setup

```bash
# Install dependencies
npm install

# Build the service
npm run build

# Run tests
npm run test

# Start development server
npm run dev
```

### Environment Variables

- `POSTGRES_HOST` - Database host (default: localhost)
- `POSTGRES_PORT` - Database port (default: 5432)
- `POSTGRES_DB` - Database name (default: sourcify)
- `POSTGRES_USER` - Database user
- `POSTGRES_PASSWORD` - Database password
- `POSTGRES_SCHEMA` - Database schema (default: public)
- `PORT` - Service port (default: 80)

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

## Deployment

The service is automatically built and deployed via CircleCI when:

- Changes are made to `services/4byte/` on staging/master branches
- Tags matching `sourcify-4byte@*` are pushed

Images are published to: `ghcr.io/argotorg/sourcify/4byte`

## Architecture

- **Database Layer**: PostgreSQL with optimized signature queries
- **API Layer**: Express.js with OpenAPI validation
- **Service Layer**: Signature extraction and canonical filtering
- **Docker**: Multi-stage build with production optimization
