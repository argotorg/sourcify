# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Sourcify is an open-source smart contract verification service for Ethereum and compatible blockchains. The repository is a monorepo containing:

- **services/server**: HTTP API server for contract verification with PostgreSQL database backend
- **services/monitor**: Chain monitoring service that automatically detects new contracts and submits them for verification
- **services/database**: PostgreSQL database schema, migrations, and related scripts using dbmate
- **packages/lib-sourcify**: Core verification library for contract validation, compilation, and verification
- **packages/bytecode-utils**: Library for extracting metadata from bytecode
- **packages/compilers**: Wrapper around Solidity and Vyper compilers
- **packages/compilers-types**: TypeScript types for compilers

## Common Commands

### Building

```bash
# Build all packages and services
npx lerna run build

# Clean build (removes node_modules and rebuilds everything)
npm run build:clean

# Build specific package/service
cd services/server && npm run build
```

### Testing

```bash
# Run all tests across all packages/services
npm run lerna-test

# Run server tests with database setup
cd services/server && npm run test-local

# Run specific test suite:
# Server unit tests
cd services/server && npm run test:unit
# Server integration tests
cd services/server && npm run test-local
# Server chain tests
cd services/server && npm run test:chains


# Run lib-sourcify tests
cd packages/lib-sourcify && npm test
```

### Linting and Formatting

```bash
# Lint all packages/services
npm run lerna-lint

# Lint specific service
cd services/server && npm run check

# Fix linting issues
npm run lerna-fix

# Fix specific service
cd services/server && npm run fix
```

### Database Operations

IMPORTANT: Double check the `.env` file in `services/database` and ask for approval before running any `npm run migrate` commands

```bash
# Navigate to database service
cd services/database

# Check migration status
npm run migrate:status

# Run pending migrations
npm run migrate:up

# Create new migration
npm run migrate:new <migration_name>
```

### Development Server

```bash
# Start the main server (requires database setup)
cd services/server && npm start

# Start monitor service
npm run monitor:start
```

## Architecture

### Core Verification Flow

1. **Validation**: `SolidityMetadataContract` validates source files and fetches missing sources from IPFS
2. **Compilation**: `SolidityCompilation`/`VyperCompilation` compile contracts using appropriate compilers
3. **Verification**: `Verification` class compares compiled bytecode with on-chain bytecode using `SourcifyChain`

### Database Architecture

- Based on Verifier Alliance database schema with Sourcify-specific extensions
- Key tables: `verified_contracts`, `contract_deployments`, `sourcify_matches`, `compiled_contracts`
- Uses dbmate for migrations and schema management
- Supports both full and partial verification matches

### Storage Services

The server supports multiple storage backends:

- `SourcifyDatabase`: PostgreSQL database (primary for API v2)
- `RepositoryV1`: Legacy filesystem storage (deprecated)
- `RepositoryV2`: IPFS-compatible filesystem storage
- `AllianceDatabase`: Verifier Alliance database integration

### Chain Configuration

- Chain support defined in `services/server/src/sourcify-chains-default.json`
- Supports authenticated RPCs, Etherscan APIs, and trace/debug APIs for factory contracts

### API Structure

- **v1 API**: Legacy endpoints under `/` (deprecated, adds `Deprecation: true` header)
  - Session-based verification: `/session`
  - Stateless verification: `/verify`
  - Repository access: `/files`, `/check-by-addresses`
  - Etherscan integration: `/verify/etherscan`
- **v2 API**: Modern endpoints under `/v2` (requires database backend)
  - Contract lookup: `/v2/contracts`, `/v2/contract/`
  - Verification: `/v2/verify`
  - Job lookup: `/v2/verify`
- OpenAPI/Swagger documentation available at runtime at `/api-docs/swagger.json`

## Development Workflow

### Setting Up Local Development

1. Run `npm install` from project root
2. Build packages: `npx lerna run build`
3. Set up PostgreSQL database (see services/database/README.md)
4. Run database migrations
5. Configure environment variables in services/server/.env
6. Start server: `cd services/server && npm start`

### Database Schema Changes

- For Sourcify-specific changes: Add migration in `services/database/migrations/`
- For Verifier Alliance changes: Update submodule in `services/database/database-specs/`

### Testing Strategy

- Unit tests for individual components
- Integration tests with database setup
- Chain tests for multi-blockchain compatibility

## Key Configuration Files

- `services/server/src/config/local.js`: Local server configuration
- `services/server/src/sourcify-chains-default.json`: Supported blockchain networks
- `services/server/.env`: Environment variables

## Server-Specific Architecture

### Service Layer

- **VerificationService**: Core verification orchestrator using worker pools (Piscina)
- **StorageService**: Manages multiple storage backends (database, filesystem, S3)
- **Services class**: Dependency injection container for all services

### Worker Architecture

- Verification runs in isolated worker processes
- `verificationWorker.ts`: Handles individual verification jobs
- Configurable concurrency and worker idle timeout

### Request Flow

1. **API Layer**: Express routes with OpenAPI validation
2. **Service Layer**: Business logic and orchestration
3. **Worker Layer**: Isolated verification processing
4. **Storage Layer**: Persistence to configured backends
