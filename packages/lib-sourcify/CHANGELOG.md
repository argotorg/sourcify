# Changelog for `@ethereum-sourcify/lib-sourcify`

All notable changes to this project will be documented in this file.

## @ethereum-sourcify/lib-sourcify@1.7.2 - 2023-03-14

- Fix bytecode transformations

## @ethereum-sourcify/lib-sourcify@1.7.1 - 2023-02-26

- Fix `fsevents` to the `optionalDependencies` for Linux builds.

## @ethereum-sourcify/lib-sourcify@1.7.0 - 2023-02-22

- Support verification for bytecode containing multiple auxdatas.
  - Use `generateCborAuxdataPositions` to locate the auxdata positions in the bytecode and ignore them for a partial match.
- Add `blockNumber`, `txIndex`, and `deployer` to the `Match` type

## @ethereum-sourcify/lib-sourcify@1.6.2 - 2023-01-03

- Don't fetch `creationTx` twice
- More detailed debug logging.

## @ethereum-sourcify/lib-sourcify@1.6.1 - 2023-12-19

- Bump Typscript version and move the dependency to project root.
- Change SourcifyChainExtension types, according to the new sourcify-server's `sourcify-chains.json` format.

## @ethereum-sourcify/lib-sourcify@1.6.0 - 2023-11-23

- Remove solc as a dependency, now it must be included implementing the `ISolidityCompiler` interface
- fix `extra-file-input-bug`

## @ethereum-sourcify/lib-sourcify@1.5.0 - 2023-11-03

- Remove solc as a dependency, now the solidity compiler needs to be passed to the functions using it.
- Rename deployedBytecode into runtimeBytecode
- Use `fetchContractCreationTxUsing` object to scrape
- Always comoapile with emscripten for nightlies and versions <0.4.10
- Support creationMatch vs runtimeMatch

## @ethereum-sourcify/lib-sourcify@1.4.2 - 2023-10-19

- Bump to sync the tags on master

## @ethereum-sourcify/lib-sourcify@1.4.1 - 2023-10-18

- Remove `typeRoots` from `tsconfig.json`

## @ethereum-sourcify/lib-sourcify@1.4.0 - 2023-10-09

- Bump `ethers` to `6.7.1`
- Bump `solc` to `0.8.21`
- Split `MetadataSources` type to `MetadataSourceMap` and `MetadataSource`
- Remove package-lock.json as it is managed by root package.json by lerna

## @ethereum-sourcify/lib-sourcify@1.3.2 - 2023-09-04

- Use `https://binaries.soliditylang.org` instead of `https://github.com/ethereum/solc-bin/raw/gh-pages` for Solidity compiler binaries

## Older releases

Previously, the releases were not done one separate modules of Sourcify but for the repository as a whole.
You can find the changelog for those releases in [older releases](https://github.com/ethereum/sourcify/releases) for this repository.
