&nbsp;

<p align="center">
  &nbsp;
  <a href="https://sourcify.dev"><img src="https://raw.githubusercontent.com/sourcifyeth/assets/master/logo-assets-png/sourcify-eth-card.png" alt="sourcify logo" role="presentation" width=300></a>
</p>

[![codecov](https://codecov.io/gh/ethereum/sourcify/branch/staging/graph/badge.svg?token=eN6XDAwWfV)](https://codecov.io/gh/ethereum/sourcify)
[![Matrix Chat](https://img.shields.io/badge/Matrix%20-chat-brightgreen?style=plastic&logo=matrix)](https://matrix.to/#/#ethereum_source-verify:gitter.im)
[![Discord](https://img.shields.io/badge/Discord%20-chat-brightgreen?style=plastic&logo=discord)](https://discord.com/invite/6aqd9cfZ9s)
[![X Follow](https://img.shields.io/twitter/follow/SourcifyEth?style=plastic&logo=x)](https://X.com/SourcifyEth)

Sourcify ([sourcify.dev](https://sourcify.dev)) is a source-code verification service for Ethereum smart contracts supporting Solidity and Vyper. Sourcify is fully commited to

- Open-source (MIT License)
- Open-data (see [Downloading the repository](https://docs.sourcify.dev/docs/repository/))
- Open-standards (see the [Verifier Alliance](https://github.com/verifier-alliance))

in smart-contract verification instead of siloed, propriety services. We foster these values across the ecosystem and work actively to push the status-quo in this direction.

Different than other verification services, Sourcify leverages the [Solidity metadata](https://docs.sourcify.dev/docs/metadata/) and file and its integrity hash to ["fully verify"](https://docs.sourcify.dev/docs/full-vs-partial-match/) the Solidity contracts (see [the playground](https://playground.sourcify.dev)).

Sourcify mainly consists of:

- [sourcify-server](/services/server) - an HTTP server to run source-code verifications and store the verified contracts for the supported chains through an [API](https://docs.sourcify.dev/docs/api/)
- [sourcify-database](/services/database) - a PostgreSQL database to store the verified contracts and their metadata, and a repository for the database schema and migrations.
- [sourcify-monitor](/services/monitor) - a standalone service that listens to various EVM chains for new contract creations and automatically submits them to a Sourcify API for verification if published on IPFS.
- Packages:
  - [@ethereum-sourcify/lib-sourcify](/packages/lib-sourcify/): The core library for Sourcify. It contains the logic to verify contracts.
  - [@ethereum-sourcify/bytecode-utils](/packages/bytecode-utils/): A library to extract and parse the CBOR encoded metadata from the bytecode.
  - [@ethereum-sourcify/compilers](/packages/compilers/): A wrapper around Solidity and Vyper compilers to download the right version and invoke the compilation with a common interface.
  - [@ethereum-sourcify/compilers-types](/packages/compilers-types/): TypeScript types for the compilers.
- [Sourcify UI](https://github.com/sourcifyeth/ui) - a web UI to interact with the server, lookup, and verify contracts
- [repo.sourcify.dev](https://github.com/sourcifyeth/repo.sourcify.dev) - a web UI to browse and display verified contract information.

_ℹ️ [This monorepo](https://github.com/ethereum/sourcify) contains the main modules. The [sourcifyeth Github organization](https://github.com/sourcifyeth) contains all other auxiliary services and components._

## Documentation

For more details refer to [docs.sourcify.dev](https://docs.sourcify.dev/docs/intro/)

## How we work

Sourcify aims to be fully open and transparent. You can see what we are working day-to-day on on our [Public Issue Board](https://github.com/orgs/ethereum/projects/46) as well our [Quarterly Milestones](https://github.com/orgs/ethereum/projects/46/views/3) for our longer term plans.

## Adding a new chain

If you'd like to add a new chain support to Sourcify please follow the [chain support instructions](https://docs.sourcify.dev/docs/chain-support/) in docs.

_Sourcify is an [Argot Collective](https://argot.org) project_
