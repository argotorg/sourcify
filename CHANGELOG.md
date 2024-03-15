# Changelog for `sourcify-monorepo`

All notable changes to this project will be documented in this file.

This CHANGELOG will contain monorepo related changes such as CI configs, shared dependencies and the development setup.

## sourcify-monorepo@1.2.3 - 2024-03-14

- Update dependencies

## sourcify-monorepo@1.2.2 - 2024-02-26

- Fix `fsevents` as an optional dependency for Linux builds

## sourcify-monorepo@1.2.1 - 2024-02-22

- Assign resources to CI jobs for faster runs (when 100% CPU) or cheaper runs
- Add a DB container to the tests
- Don't run full tests in `test-new-chains` if no `NEW_CHAIN_ID` is set
- Support both `add-new-chain-{chainIds}` and `add-new-chains-{chainIds}` as branch names for new chains
- Add `fsevents` as an optional dependency for Linux builds

## sourcify-monorepo@1.2.0 - 2024-01-04

- Add multiarch image builds
- Adjust resources for CI builds. This should speed up the builds and reduce the usage for unnecessary resources.
- Optimize some runs by not install and building unless necessary

## sourcify-monorepo@1.1.2 - 2024-01-03

- Update `FUNDING.json`
- Add arm64 build runs to CI but turn them off for now

## sourcify-monorepo@1.1.1 - 2023-12-19

- Fix tagged builds not being triggered because they are not in the entrypoint circleci YML file.
- Fix `latest` tag not being pushed to Docker Hub.

## sourcify-monorepo@1.1.0 - 2023-12-19

- Move CI scripts to `.circleci/scripts`
- Change CircleCI config:
  - Always run all images instead of only the changed ones
  - Add a new tagged_build_and_publish that gets triggered on new tags
  - build_and_publish_docker_images accroding to the new container and versioning setup
- Remove `environments` folder
- Remove unused env vars from `.vscode/launch.json`
- Move Typscript to root `package.json` and remove it from all subpackages
- Add `printWidth` to `.prettierrc`

## Older releases

Previously, the releases were not done one separate modules of Sourcify but for the repository as a whole.
You can find the changelog for those releases in [older releases](https://github.com/ethereum/sourcify/releases) for this repository.
