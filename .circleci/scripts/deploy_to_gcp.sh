#!/bin/bash

# Checks the new tag of the built image for each service (server, monitor)
# The tag value is persisted in worspace/{service}_image_sha.txt by each respective build job
# If a new image is built with a new tag, a deploy trigger is sent to the sourcifyeth/infra repo

# Exit immediately if a command exits with a non-zero status.
set -e

# Define the list of services
services=("server" "monitor")

ARTIFACT_REGISTRY_URL="europe-west1-docker.pkg.dev/sourcify-project/ghcr-proxy/ethereum/sourcify/"

if [ "$CIRCLE_BRANCH" == "staging" ]; then
    ENVIRONMENT='staging'
elif [ "$CIRCLE_BRANCH" == "master" ]; then
    ENVIRONMENT='production'
else
    echo "Invalid branch $CIRCLE_BRANCH. Check your config.yml"
    exit 1
fi

# Loop through each service
for service in "${services[@]}"; do

    echo ""
    echo "Deploying $service"
    # Deploy from amd64 image
    filePath="workspace/${service}_amd64_image_sha.txt"

    if [ -f "$filePath" ]; then
        echo "File $filePath exists."

        image_sha=$(cat "$filePath")

        # Check if the content is not an empty string
        if [ -n "$image_sha" ]; then
            echo "File is not empty."

            image_tag="$CIRCLE_BRANCH"@"$image_sha"

            # sourcify-staging-server or sourcify-production-server
            cmd="gcloud run deploy sourcify-$ENVIRONMENT-$service --project sourcify-project --region europe-west1 --image $ARTIFACT_REGISTRY_URL$service:$image_tag"

            echo "Running cmd"
            echo $cmd

            # Execute the command
            eval $cmd

            echo "Deployed with gcloud using:"
            echo $cmd
        else
            echo "File for $service is empty."
            exit 1
        fi
    else
        echo "File $filePath does not exist."
    fi
done
