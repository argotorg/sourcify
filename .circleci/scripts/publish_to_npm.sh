#!/bin/bash
set -e

# Set npm auth token
npm config set //registry.npmjs.org/:_authToken=${NPM_TOKEN}

# Helper Functions
# ----------------

# Function to get local version
get_local_version() {
  cat "$1/package.json" |
    grep version |
    head -1 |
    awk -F: '{ print $2 }' |
    sed 's/[",]//g' |
    tr -d '[[:space:]]'
}

# Function to get npm version
get_npm_version() {
  npm view "$1" dist-tags.latest
}

# Function to publish package if versions differ
publish_if_new_version() {
  local_version=$(get_local_version "$1")
  npm_version=$(get_npm_version "$2")

  if [ "$local_version" = "$npm_version" ]; then
    echo "$2:"
    echo "Latest npm version is equal to current package version. Up the version to publish to npm."
  else
    npm publish -w "$2" --verbose --access=public
  fi
}

# Define package directories and their corresponding npm package names, e.g.
# packages/bytecode-utils:@ethereum-sourcify/bytecode-utils
packages=(
  "packages/bytecode-utils:@ethereum-sourcify/bytecode-utils"
  "packages/compilers:@ethereum-sourcify/compilers-types"
  "packages/compilers:@ethereum-sourcify/compilers"
  "packages/lib-sourcify:@ethereum-sourcify/lib-sourcify"
  "services/server:sourcify-server"
)

# Publish packages
for package in "${packages[@]}"; do
  IFS=':' read -r local_path npm_package <<<"$package"
  if [[ $CIRCLE_TAG == *"${npm_package}@"* ]]; then # Only publish if tag contains exact package name followed by @.
    echo "$CIRCLE_TAG matches $npm_package, publishing $npm_package"
  else
    echo "Skipping $npm_package as CIRCLE_TAG $CIRCLE_TAG doesn't start with $npm_package"
    continue
  fi

  publish_if_new_version "$local_path" "$npm_package"
done
