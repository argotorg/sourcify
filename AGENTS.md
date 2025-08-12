# Repository Guidelines

## Project Structure & Module Organization

- Monorepo (Lerna + Nx). Workspaces: `packages/*` (libraries) and `services/*` (runtimes).
- Services:
  - `services/server`: HTTP API and CLI.
  - `services/monitor`: chain listener that forwards contracts to the server.
  - `services/database`: PostgreSQL schema, migrations, and DB utilities.
  - `services/ipfs` and `services/ipfs-repository`: IPFS keys/assets and repository helpers.
- Packages:
  - `@ethereum-sourcify/lib-sourcify`: verification core, types, validators.
  - `@ethereum-sourcify/bytecode-utils`: bytecode decoding utilities.
  - `@ethereum-sourcify/compilers` and `compilers-types`: solc wrappers and shared types.
  - `packages/contract-call-decoder`: prebuilt decoder artifacts in `build/`.
- Support: `scripts/` (maintenance), `environments/` (deploy configs). Builds emit to `dist/` or `build/`.

## Build, Test, and Development Commands

- From root:
  - `npm run build:lerna`: build all workspaces.
  - `npm run lerna-test`: run tests across all packages/services.
  - `npm run lerna-lint` | `npm run lerna-fix`: lint or autofix across workspaces.
  - `npm run server:start` | `npm run monitor:start`: start compiled server/monitor.
- Per package/service (example):
  - `cd services/server && npm run build && npm start`
  - `cd services/monitor && npm run build && npm start`
  - `cd packages/lib-sourcify && npm run build && npm test`

## Coding Style & Naming Conventions

- Language: TypeScript (Node v22, see `.nvmrc`).
- Formatting: Prettier (print width 80). Linting: ESLint with `@typescript-eslint` and Prettier.
- Indentation: 2 spaces; avoid unused vars; `any` allowed sparingly (see `.eslintrc.js`).
- Filenames: use `kebab-case` for files, `PascalCase` for classes, `camelCase` for variables/functions.

## Testing Guidelines

- Framework: Mocha with `c8` coverage.
- Common patterns: unit tests under `test/unit/**`, integration under `test/integration/**`, or `test/**/*.spec.ts` in libraries.
- Run all tests: `npm run lerna-test`. Coverage reports via per-package `npm run cov`.
- Server integration tests need Postgres (Docker): `cd services/server && npm run test-local`.

## Database Schema

- Primary schema snapshot: `services/database/db/schema.sql`. Load the whole file in the context if you need to know how the database is structured
- Load into Postgres (example):
  - `cd services/database`
  - `export DATABASE_URL=postgres://user:pass@127.0.0.1:5432/sourcify?sslmode=disable`
  - `DBMATE_SCHEMA_FILE=./db/schema.sql dbmate load`
- Migrations: use `npm run migrate:up` and related scripts in `services/database` (dbmate under the hood).

## Commit & Pull Request Guidelines

- Follow Conventional Commits (e.g., `feat: …`, `fix: …`). Commitizen is configured in libraries.
- PRs: include clear description, linked issues, and tests. Use the PR template under `.github/`.
- Chain support PRs: branch `add-chain-<chainId>` and follow checklist in `.github/pull_request_template.md`.

## Security & Configuration Tips

- Environment: use `.env` and `config/` per service; never commit secrets.
- Updating chains: `npm run update-chains` updates `services/server/src/chains.json` from chainid.network.
