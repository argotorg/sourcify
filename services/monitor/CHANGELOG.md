# Changelog for `sourcify-monitor`

All notable changes to this project will be documented in this file.

## sourcify-monitor@1.3.14 - 2025-06-18

- Update packages

## sourcify-monitor@1.3.13 - 2025-05-20

- update dependencies

## sourcify-monitor@1.3.12 - 2025-05-12

- Update dependencies

## sourcify-monitor@1.3.11 - 2025-05-06

- update dependencies

## sourcify-monitor@1.3.10 - 2025-04-30

- Add Ethereum Testnet Hoodi (560048) to monitored chains
- Update dependencies

## sourcify-monitor@1.3.9 - 2025-04-09

- Update dependencies
- Use the new `FetchRequestRPC`

## sourcify-monitor@1.3.8 - 2025-03-19

- Update dependencies

## sourcify-monitor@1.3.7 - 2025-02-18

- Add Zircuit mainnet (48900) to monitored chains

## sourcify-monitor@1.3.6 - 2025-02-06

- update dependencies

## sourcify-monitor@1.3.5 - 2025-01-08

- Update dependencies


## sourcify-monitor@1.3.4 - 2024-12-11

- Update dependencies

## sourcify-monitor@1.3.3 - 2024-10-29

- Update monitor RPCs to public ones
- Update packages

## sourcify-monitor@1.3.2 - 2024-10-14

- Update monitor RPCs
- Update packages
- Don't throw when unable to submit contracts to Sourcify servers

## sourcify-monitor@1.3.1 - 2024-09-17

- Allow generic ApiKeys for chains in chains.json
- Log blockIntervals every min regularly
- Update logging
- Add tests for parsing authenticated RPCs
- Update dependencies

## sourcify-monitor@1.3.0 - 2024-08-29

- Added retry mechanism when sending contracts to the Sourcify server.
- Added custom headers for the IPFS gateway
- Change chains that are being monitored by default
- Update packages

## sourcify-monitor@1.2.0 - 2024-07-25

- Update dependencies
- Refactor tests and use TS

## sourcify-monitor@1.1.14 - 2024-05-14

- bump version

## sourcify-monitor@1.1.13 - 2024-04-23

- Make package private

## sourcify-monitor@1.1.12 - 2024-04-04

- Update dependencies

## sourcify-monitor@1.1.11 - 2024-03-28

- Improved logging:
  - Log nicely formatted line logs in development and JSON logs in production
  - Added `NODE_LOG_LEVEL` env variable
  - Enable dynamic log level chaning through a simple web server. Just send:
  ```bash
  curl -X POST -H "Content-Type: application/json" -d '{"level": "debug"}' http://localhost:3333
  ```

## sourcify-monitor@1.1.10 - 2024-03-14

- Rename chains.json to monitorChains.json

## sourcify-monitor@1.1.9 - 2024-02-26

- Make monitor Dockerfiles similar to server

## sourcify-monitor@1.1.8 - 2024-02-22

- Remove ethpandaops RPCs for Sepolia and Goerli temporarily.

## sourcify-monitor@1.1.7 - 2024-01-03

- Point dotenv to the correct file

## sourcify-monitor@1.1.6 - 2023-12-19

- Remove `version.ts` as this was causing a versioning loop.

## sourcify-monitor@1.1.5 - 2023-12-19

- Update monitor docker to use multi-stage builds and use bullseye-slim
- Fix notifying subscribers without trying next gateways in DecentralizedStorageFetcher
- Update README
- Remove localhosts from default chains
- Remove Typescript from dependencies and move to the project root

## sourcify-monitor@1.1.4 - 2023-11-23

- Update lib-sourcify

## sourcify-monitor@1.1.3 - 2023-11-03

- Monitor tests in js
- Fix `authenticateRpcs``

## sourcify-monitor@1.1.2 - 2023-10-23

- Handles Alchemy API keys for Optimism and Arbitrum

## sourcify-monitor@1.1.1 - 2023-10-19

- Bump to sync the tags on master

## sourcify-monitor@1.1.0 - 2023-10-18

- Add tests to sourcify-monitor
- Enable passing parameters other than `lastBlock` to each `ChainMonitor`

## sourcify-monitor@1.0.0 - 2023-10-09

No changes this release. This marks the start of the changelog for this module.

This was a total rewrite of the sourcify-monitor as a completely isolated module from the sourcify-server. Previously it was sharing the verification logic as well as the filesystem. The new sourcify-monitor will detect contract creations and send them to an existing sourcify server in HTTP requests. See the [README](./README.md) for more information.

## Older releases

Previously, the releases were not done one separate modules of Sourcify but for the repository as a whole.
You can find the changelog for those releases in [older releases](https://github.com/ethereum/sourcify/releases) for this repository.
