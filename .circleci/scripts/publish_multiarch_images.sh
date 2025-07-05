#!/bin/bash
set -e

# Based on: https://www.docker.com/blog/multi-arch-build-and-images-the-simple-way/
# Images are built for each architecture (amd64, arm64) and pushed to Github Container Registry under their arch e.g. ghcr.io/ethereum/sourcify/server:staging-amd64
# Here we pull and retag the images with the arch suffix removed e.g. ghcr.io/ethereum/sourcify/server:staging

NAMESPACE="ghcr.io/ethereum/sourcify"
# Define the list of services
services=("server" "monitor")

# Login to Github Container Registry
echo $GITHUB_CR_PAT | docker login ghcr.io --username kuzdogan --password-stdin

# Triggered by a branch
# e.g. sourcify/server:master
if [ -n "$CIRCLE_BRANCH" ]; then
  # Loop through each service
  for service in "${services[@]}"; do
    image_name="$NAMESPACE/$service"
    echo "Creating manifest for $image_name:$CIRCLE_BRANCH"
    docker manifest create \
      "$image_name:$CIRCLE_BRANCH" \
      --amend "$image_name:$CIRCLE_BRANCH-amd64" \
      --amend "$image_name:$CIRCLE_BRANCH-arm64"

    echo "Pushing manifest for $image_name:$CIRCLE_BRANCH"
    docker manifest push "$image_name:$CIRCLE_BRANCH"
  done
# Triggered by a tag (release)
# e.g. sourcify/server:latest  &  sourcify/server:0.1.0
elif [ -n "$CIRCLE_TAG" ]; then
  # Assuming CIRCLE_TAG is something like "sourcify-monitor@1.1.3"
  # Extract the version number after the last '@'
  VERSION=${CIRCLE_TAG##*@}
  # Extract the part before '@' symbol which includes 'sourcify-'
  SERVICE_WITH_PREFIX=${CIRCLE_TAG%@*}
  # Remove the 'sourcify-' prefix to get just the SERVICE name
  SERVICE=${SERVICE_WITH_PREFIX#sourcify-}
  image_name="$NAMESPACE/$SERVICE"

  # Create a manifest for the version tag
  echo "Creating manifest for $image_name:$VERSION"
  docker manifest create \
    "$image_name:$VERSION" \
    --amend "$image_name:$VERSION-amd64" \
    --amend "$image_name:$VERSION-arm64"

  # Also create a manifest for the latest tag
  echo "Creating manifest for $image_name:latest"
  docker manifest create \
    "$image_name:latest" \
    --amend "$image_name:latest-amd64" \
    --amend "$image_name:latest-arm64"

  # Push the manifests
  echo "Pushing manifest for $image_name:$VERSION"
  docker manifest push "$image_name:$VERSION"
  echo "Pushing manifest for $image_name:latest"
  docker manifest push "$image_name:latest"
else
  echo "Error: CIRCLE_BRANCH and CIRCLE_TAG are both empty."
  exit 1 # Exit with a non-zero status to indicate an error.
fi
