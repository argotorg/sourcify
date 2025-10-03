#!/bin/bash

# This script is used to remove the .sol extension from all .sol files in repo v2

REPO_PATH="repositoryV2/contracts"

# Function to remove .sol extension
remove_sol_extension() {
    local file="$1"
    if [[ "$file" == *.sol ]]; then
        mv "$file" "${file%.sol}"
        echo "Renamed: $file -> ${file%.sol}"
    fi
}

# Recursive function to process directories
process_directory() {
    local dir="$1"
    shopt -s nullglob
    for item in "$dir"/*; do
        if [[ -d "$item" ]]; then
            process_directory "$item"
        elif [[ -f "$item" ]]; then
            remove_sol_extension "$item"
        fi
    done
    shopt -u nullglob
}


# Start processing from REPO_PATH
echo "Starting to remove .sol extensions from files in $REPO_PATH"
process_directory "$REPO_PATH"
echo "Finished removing .sol extensions"
