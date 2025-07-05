# Changelog for `sourcify-server`

All notable changes to this project will be documented in this file.

## sourcify-server@3.2.0 - 2025-06-18

- Add new endpoint /v2/contract/all-chains/{address} to get all verified deployments of a contract on all chains #2183
- Handle invalid json body error, throw if unable to fetch the compiler #2179 
- Throw an error on conflict when inserting a verified_contract #2176 
- Add contract creation transaction fetching via VeChain Stats #2182 
- Update README docs and quick start docker-compose files for easier setup
- New chains:
  - Peaq Mainnet (3338)

## sourcify-server@3.1.3 - 2025-05-20

- Use Etherscan API v2 (#2158) 

## sourcify-server@3.1.2 - 2025-05-12

- Add warning log if no database is configured (#2147)
- Clarify that a Postgres database is required for API v2 (#2144)
- Update dependencies

## sourcify-server@3.1.1 - 2025-05-06

- Fix missing compilation.metadata field in upgrade script (#2135)
- Fix traceId not logged inside worker when verifying via Etherscan import (#2137)
- Turn off Rollux Mainnet (570)
- Use default telos RPCs

## sourcify-server@3.1.0 - 2025-04-30

- Add API v2 verification endpoints:
  - POST `/v2/verify/{chainId}/{address}`
  - POST `/v2/verify/metadata/{chainId}/{address}`
  - POST `/v2/verify/etherscan/{chainId}/{address}`
- Deprecate API v1
- Add options to configure libSourcify in server
- Add options to configure the new Piscina worker for v2 verification
- Add new chains:
  - Superseed Mainnet (5330)
  - Corn Mainnet (21000000)
  - Etherlink (42793)
  - Etherlink Testnet (128123)
- Fix SIGTERM handling of server containers
- Fix missing error handler when no metadata.json found
- Improve logging
- Copy fetchContractCreationTxUsing for an unknown chain
- Add docker compose configuration for running locally
- Update dependencies

## sourcify-server@3.0.0 - 2025-04-09

- Integrate new lib-sourcify classes in server (#1960) 
- Use VerificationExport for storeVerification methods of storage services (#1995)
- Improve express error handler (#2027)
- Add upgrade contract private endpoint (#2042)
- Add updated_at column and trigger to sourcify_matches (#2047) 
- Remove rate limiter (#2046)
- Update sourcify-chains-default.json to set multiple chains as unsupported
- Add sourceIds field to v2 lookup (#2060)
- Update Hoodi Testnet with RPCs and creatorTxHash
- Update dependencies

New Chains:
- Added Zircuit Garfield Testnet (#2016)

## sourcify-server@2.7.1 - 2025-03-20

- hot fix for unique constraint conflicts

## sourcify-server@2.7.0 - 2025-03-19

- Add endpoints for getting verification jobs
- Deprecate v1 repository endpoints
- Use @ethereum-sourcify/compilers package instead of built-in
- Fix proxy detection for EIP1967 when storage slot is only referenced in creation code
- Fix creation match upgrade (#1969)
- Update dependencies
- New chains:
  - Ethereum Hoodi Testnet (560048)
  - Zilliqa 2 EVM proto-mainnet (32770)
  - Zilliqa 2 EVM proto-testnet (33103)
  - AME Chain Mainnet (180)
- Deprecated chains:
  - Rollux Testnet Tanenbaum (57000)
  - Telcoin Network (2017)
  - Arthera Testnet (10243)
  - YMTECH-BESU Testnet (202401)
  - Incentiv Devnet (16350)
  - Story Odyssey (1516)
  - Quantum Portal Network (26100)

## sourcify-server@2.6.1 - 2025-02-18

- add chain XDC Network (50)
- GET `/v2/contract/{chainId}/{address}` API endpoint:
  - rename `*` field to `all`
  - fix contracts not retrievable if no creation code is stored
  - fix proxy resolution to not run on unverified contracts

## sourcify-server@2.6.0 - 2025-02-06

- add API v2 lookup endpoints:
  - Add GET `/v2/contracts/{chainId}`
  - Add GET `/v2/contract/{chainId}/{address}`
- add chains:
  - Ronin Mainnet (2020)
  - Core Blockchain Testnet2 (1114)
  - exSat Mainnet (7200)
  - exSat Testnet (839999)
  - Citrea Testnet (5115)
- Add missing Etherscan api key env names
- Remove ethpandaops from holesky RPCs
- Enalbe writing to Verifier Alliance DB on production

## sourcify-server@2.5.0 - 2025-01-08

- Add Vyper verification support
- Remove lambda compiler
- New chains:
  - Happy Chain Testnet (216)
  - Quantum Portal Network (26100)

## sourcify-server@2.4.1 - 2024-12-11

- Add S3StorageService to write contracts to S3/IPFS
- Add proxy contract detection and resolution
- Change auth type and connection to the Alliance DB
- CORS options for local IPs
- New chains:
  - Ethereum Mekong Testnet (7078815900)
  - Bitrock Mainnet (7171)
  - Bitrock Testnet (7771)
  - Story Odyssey (1516)
  - Kaia Mainnet (8217) (renamed from Klaytn)
  - Kaia Kairos Testnet (1001) (renamed from Klaytn)

## sourcify-server@2.4.0 - 2024-10-29

- Refactor database utils into class #1689
- Add chains that have trace support in Quicknode with trace support
- Change `AlchemyInfura` type RPCs to generic API key RPCs
- Add `subdomain` env support for Quicknode RPCs
- New chains
  - Zircuit Mainnet (48900)
  - Zircuit Testnet (48899)
  - Metis Andromeda Mainnet (1088)
  - Metis Sepolia Testnet (59902)
- Turn Flare Mainnet back on

## sourcify-server@2.3.0 - 2024-10-14

- Incorporate the new DB schema with separate sources table
- Reusable server module (#1637): It's possible to create server instances fully with `new Server()`.
- Use server public url in getTree instead of repositoryV1 url (#1677)
- Use source_hash instead of source_hash_keccak when finding sources (#1671)
- Remove .sol extension in repositoryV2 (#1648)
- New chains:
  - Polygon zkEVM Cardona Testnet (2442)
  - B2 Mainnet (223)
  - OORT Mainnet (970)
  - TixChain Testnet (723107)

## sourcify-server@2.2.1 - 2024-09-17

- Check Blockscout first instead of Etherscan for creatorTxHash'es
- Fix passing invalid addresses in url crashing server
- Fix saving the contract when there's an improved match
- Added chains:
  - Curtis Testnet (3311)

## sourcify-server@2.2.0 - 2024-08-29

- Add IPFS Gateway Headers env var
- Change requestId to traceID and make it compatible for GCP with W3C standard "traceparent" headers
- Remove duplicate ValidationError in favor of BadRequestError
- Add ConflictError for when a contract is already partially verified and the verification yields partial again (HTTP 409)
- Add `verifyDeprecated` endpoint for syncing/migration
- Change the default Storage backend to the SourcifyDatabase
- Change config for the GCP setup e.g. turn off lambda compiler
- Don't update repository tag on every new verification.
- New chains:
  - Telcoin Network (2017)
- Deprecated chains:
  - Mind Smart Chain Testnet (9977)
  - Gather Mainnet (192837465)
  - Rikeza Network (1433)
  - Taraxa Testnet (842)
- Clean up tests to re-use duplicate sources in chain tests

## sourcify-server@2.1.0 - 2024-07-25

- Update dependencies
- Refactor tests and use TS in tests
- Allow choosing the storage backends in config: SourcifyDatabase, AllianceDatabase, repoV1, repoV2
- Adjust changes in the VerA DB: #1479 #1478 #1476 #1472
- Convert FQNs of libraries from the SourcifyDB Transformations to legacy placeholder format when serving "library.json" files #1487
- Add VerificationService.init() and an option in config to download all compilers in boot
- Upgrade to Node v22
- Store metadata in database
- Fix bytecode hash calculation #1414
- New chains:
  - Mante Sepolia Testnet (5003) with Etherscan support
  - Aura Xstaxy Mainnet (6322)
  - HOME Verse Mainnet (19011)
  - Lamina1 (10849)
  - Lamina1 Identity (10850)
  - Lamina1 Testnet (764984)
  - Lamina1 Identity Testnet (767368)
  - VeChain Mainnet (100009)
  - VeChain Testnet (100010)
  - Base Sepolia Tesnet (84532) with Etherscan support
  - Linea Mainnet (59144) with Etherscan support
  - Linea Sepolia (59141) with Etherscan support
  - Taraxa Mainnet (841)
  - PLYR PHI (16180)
  - PLYR TAU Testnet (62831)
  - Taraxa Testnet (842)
  - Incentiv Devnet (16350)
- Updated chains:
  - Add Alchemy fallback to Holesky (17000)
  - Add fetchContractCreationTx API for Oasis Emerald (42262), Emerald Testnet (42261), Sapphire (23294), and Sapphire Testnet (23295)
  - Add Etherscan support to Mantle Mainnet (5000)

## sourcify-server@2.0.0 - 2024-05-28

- Use Sourcify Database as source of truth #1328, from now on existance of verified contracts will be checked from the Sourcify PostgreSQL database and not filesystem based RepositoryV1
- New chains:
  - Redstone (690)
  - Garnet Holesky (17069)
  - PlayFair Testnet Subnet (12898)

## sourcify-server@1.7.0 - 2024-05-14

- Support for multiple auxdata contracts
- Refactoring the tests into Typescript
- Fix error level logs to info
- Fix Vyper contracts from Etherscan
- New chains:
  - Xai Mainnet (660279)
  - Xai Testnet (37714555429)
  - Stratis Mainnet (105105)
  - Auroria Testnet (205205)
  - Merlin Mainnet (4200)
  - Aura Euphoria Testnet (6321)
  - Bitlayer Mainnet (200901)
  - Bitlayer Testnet (200810)

## sourcify-server@1.6.0 - 2024-04-23

- Use Postgres session table for session instead of memory only
- Add dry run parameter for the session verify endpoint
- Increase lambda function max response size by swithching to streaming
- Add fallback to the local compiler when the lambda response is too large
- Don't store contract once again if it's already partial and the result is partial
- New chains:
  - Tangle (5845)
  - Swisstronik (1291)
  - Polygon Amoy Testnet (80002)
  - DEGEN (666666666)
- Deprecated chains:
  - Polygon Mumbai Testnet (80001)

## sourcify-server@1.5.6 - 2024-04-04

- Fix checkAndFetchMissing failing in session API

## sourcify-server@1.5.5 - 2024-04-04

- Update dependencies
- Fix session API takes too long to respond on production (#1289)
- Improve logging
- New chains:
  - YMTECH-BESU Testnet (202401)
- Deprecated chains:
  - Ethereum Goerli Testnet (5)

## sourcify-server@1.5.4 - 2024-03-28

- Improved logging:
  - Log nicely formatted line logs in development and JSON logs in production
  - Added `NODE_LOG_LEVEL` env variable
  - Enable dynamic log level chaning through an authenticaed endpoint `/change-log-level`. The auth token is set at `SETLOGGING_TOKEN`
- Fix path sanitization not sanitizing new lines `\n`.
- Updating verified contract in the DB. Previously it was just inserting.
- Add tests for Database
- New chains:
  - Fraxtal (252)
  - Fraxtal Testnet (2522)
  - Phoenix Mainnet (13381)

## sourcify-server@1.5.3 - 2024-03-15

- New chains:
  - Endurance Smart Chain Mainnet (648)
  - CrossFi Chain Testnet (4157)
  - Tiltyard Mainnet (710420)
- Deprecated chains:
  - Base Goerli Testnet (84531)

## sourcify-server@1.5.2 - 2024-03-14

- Update address for chain 534352 with standard-json
- Fix repository key name in local-test.js
- Update test contract address for Arthera Testnet
- Increase session api tests timeout
- Fix library transformation, use bytea instead of string for bytea
- Bug/fixed issue 1271 files stored with incorrect runtime match
- Implement verifier alliance tests
- Oasis chains: Use new fetchContractCreationTxUsing URLs
- Fix tests after new extra-file-input-bug responses
- Fix #1288 add unexpected field validation
- Fix wrong runtimeMatch check after creation match
- #1293 insert sync row in sourcify_sync for each match until sync ends
- Fix Telos chain name in tests
- Turn off chains: 78430, 78431, 78432
- Add Ozone Chain Mainnet (#1292)
- Update migration script
- Add repositoryV2 in master config
- Remove goerli e2e tests
- New chains:
  - Ozone Chain Mainnet

## sourcify-server@1.5.1 - 2024-02-26

- Allow passing Etherscan API key as parameter in import from Etherscon
- Hot fix checkAllByChainAndAddress was calling checkByChainAndAddress

## sourcify-server@1.5.0 - 2024-02-22

- Readies the server for the new database based architechture (but does not write yet because the env's are not set as of deployment.)
  - Currently Sourcify is based on a filesystem. This release prepares the server to be able to use a database instead of the filesystem. DB gives us more flexibility and other things like querying, scalability, and lets us support other languages because the filesystem assumes metadata.json
  - The database is based on the Verifier Alliance database schema, plus an additional DB for sourcify needed information
  - We'll write to the DB and FS simulatanously for a while. Still, the FS is the source of truth until full migration.
  - Scripts available to migrate the DB.
  - repository (filesystem) is now repositoryV1. We keep it for backwards compatibility but we'll remove it soon.
  - We'll have repository V2 will be here long term and will replace V1. The main purpose is to serve files on IPFS. Here we normalize the file names with their hashes which should solve the name problems [#515](https://github.com/ethereum/sourcify/issues/515).
- Replace the keccak256 identifier generation in the session with a lightweight hash (node crypto's sha1)
- New chains:
  - ZetaChain Mainnet (7000)
  - Lyra Mainnet (957)
  - Arthera Mainnet (10242)
  - Polygon zkEVM (1101)
  - Scroll (534352)
  - Scroll Sepolia Testnet (534351)
  - Mode (34443)
  - Mode Testnet (919)
  - Conflux eSpace (1030)
  - ZKFair Mainnet (42766)
  - Ligtlink Phoenix Mainnet (1890)
  - Lightlink Pegasus Testnet (1891)
  - Kroma (255)
  - Kroma Sepolia (2358)
- Deprecated chains:
  - Gather Testnet (356256156)

## sourcify-server@1.4.4 - 2024-01-04

- Fix staging `rateLimit` config that is missing

## sourcify-server@1.4.3 - 2024-01-03

- Increase "master" rate limit to 2 req/sec
- Add rate limit to the config file
- Add `local-test.js` config file for tests. Pass `NODE_CONFIG_ENV=test` to use it.
- Improved logging
- Point dotenv to the correct file
- Pass direcory to `verifyContract` function in `chain-tests.js` instead of each file.
- Add missing files in few chain tests to avoid IPFS fetching.
- Deprecated chains:
  - Klaytn Mainnet Cypress (8217)
  - Taiko Grimsvotn L2" (167005)
  - Taiko Eldfell L3 (167006)
  - Kekchain Main Net (kekistan) (420420)
  - Kekchain Test Net (kektest) (420666)
- Updated Evmos `blockscoutScrape` URL

## sourcify-server@1.4.2 - 2023-12-19

- Revert hotfix in 1.4.1

## sourcify-server@1.4.1 - 2023-12-19

- Fix already partially verified contracts being verified again instead of retuning the existing verification.

## sourcify-server@1.4.0 - 2023-12-19

- Remove `CREATE2` verification and related code as it is not used and makes the code unnecessarily complex with `AUTH0` etc.
- Clean-up environment variables and enable passing configs in a .js file. https://github.com/ethereum/sourcify/pull/1232. Use config instead of env vars.
- Enable passing `sourcify-chains.json` as a file instead of a built-in `sourcify-chains.ts` https://github.com/ethereum/sourcify/pull/1223
- Change the `RepositoryService` to `IpfsRepositoryService`. Create an umbrella `StorageService` to handle all storage related operations. Also a `AllianceDatabase` service under the `StorageService` which is currently not used (turned off).
- Use multi-stage Docker builds and use bullseye-slim
- Bring whitelists for rate limiting
- Improved logging, remove `SourcifyEventManager`.
- Update README for passing `sourcify-chains.json` and the server configs (`default.js` etc) file and how to run the Docker containers
- Remove Typescript from dependencies and move to the project root
- Remove snowtrace.io from Etherscan support
- New Chains:
  - Arbitrum Sepolia (421614)
  - Optimism Sepolia (11155420)
  - Stratos Mainnet (2048)
  - Stratos Testnet (2047)
  - Energi Testnet (49797)
  - Energi Mainnet (39797)
  - Mantle Mainnet (5000)
  - Crosbell Mainnet (3737)
  - Rikeza Network (1433)
  - Zeniq Mainnet (383414847825)
  - Tiltyard Subnet (1127469)
- Deprecated Chains:
  - Arbitrum Goerli (421613)
  - Optimism Goerli (420)

## sourcify-server@1.3.1 - 2023-11-23

- Add AWS_LAMBDA_FUNCTION to specify the name of the lambda function

## sourcify-server@1.3.0 - 2023-11-23

- Use compiler as a lambda function
- Custom compiler using SOLIDITY_COMPILER env variable: `local`, `lambda`
- Run tests in parallel
- New chains:
  - Coredao testnet chain (1115)
  - Rootstock (30)
  - Zora Sepolia Testnet (999999999)

## sourcify-server@1.2.0 - 2023-11-03

- Add support for the Verifier Alliance (disabled)
- Move server under ./services in the monorepo
- Refactor contract creation transaction fetcher
- Minor fixes

## sourcify-server@1.1.2 - 2023-10-19

- Add a filter to prevent the same contract to be verified simultaneously

## sourcify-server@1.1.1 - 2023-10-09

- Remove monitor code from the server directory `src/`
- Update chains.json
- Renaming `ALCHEMY_ID` and `INFURA_ID` to `..._API_KEY`
- Remove the `monitored` field from `sourcify-chains.ts`
- New chains:
  - Ethereum Holesky Testnet (17000)
  - PulseChain Mainnet (369)
  - Mind Smart Chain Mainnet (9996)
  - Mind Smart Chain Testnet (9977)
  - Shrapnel Testnet (2038)
  - Shrapnel Subnet (2044)
  - Arthera Testnet (10243)
  - Core Blockchain Mainnet (1116)
  - Q Mainnet (35441)
  - Q Testnet (35443)

## sourcify-server@1.1.0 - 2023-09-04

- Updated lerna to `7.1.5`
- #1158 Add `REPOSITORY_URL_HOST` env variable to `sourcify-server` to allow for custom repository paths in containers. Previously this was hardcoded as `../../data/repository`
- Updates chains.json
- New chains:
  - Kiwi Subnet (2037)
  - Beam Subnet (4337)
  - Amplify Subnet (78430)
  - Bulletin Subnet (78431)
  - Conduit Subnet (78432)

## Older releases

Previously, the releases were not done one separate modules of Sourcify but for the repository as a whole.
You can find the changelog for those releases in [older releases](https://github.com/ethereum/sourcify/releases) for this repository.
