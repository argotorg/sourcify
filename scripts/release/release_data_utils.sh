#!/bin/bash
# Utility functions for handling package data persistence via a temporary file.

source "${SCRIPT_DIR}/logging_utils.sh"
# Ensure SCRIPT_DIR is available, assuming this is sourced by main.sh where SCRIPT_DIR is defined.
TEMP_PACKAGE_DATA_FILE="${SCRIPT_DIR}/.release_package_data.tmp"

# Function to write all package data to the temp file
# Args:
#   $1: Name of the directories array
#   $2: Name of the packageNames array
#   $3: Name of the versions array (current versions)
#   $4: Name of the selected_versions associative array (pkgName -> selectedVersion)
write_package_data() {
  local -n dirs_ref=$1     # Nameref for directories array
  local -n names_ref=$2    # Nameref for packageNames array
  local -n vers_ref=$3     # Nameref for versions array
  local -n selected_ref=$4 # Nameref for selected_versions associative array

  echo "Writing package data to $TEMP_PACKAGE_DATA_FILE"
  # Clear the file or create it if it doesn't exist
  >"$TEMP_PACKAGE_DATA_FILE"

  for index in "${!names_ref[@]}"; do
    local pkg_name="${names_ref[$index]}"
    local dir="${dirs_ref[$index]}"
    local current_ver="${vers_ref[$index]}"
    local selected_ver="${selected_ref[$pkg_name]}" # Get selected version using package name as key

    if [ -z "$pkg_name" ]; then
      warn "Skipping empty package name at index $index during write."
      continue
    fi
    # Format: directory:packageName:currentVersion:selectedVersion
    echo "${dir}:${pkg_name}:${current_ver}:${selected_ver}" >>"$TEMP_PACKAGE_DATA_FILE"
  done
  echo "Package data written successfully to $TEMP_PACKAGE_DATA_FILE"
}

# Function to load package data from the temp file into global-like bash arrays
# This will redefine/populate:
#   packageNames (indexed array)
#   directories (indexed array)
#   versions (indexed array - stores current versions read from file)
#   selected_versions (associative array: pkgName -> selectedVersion)
load_package_data_into_arrays() {
  if [ ! -f "$TEMP_PACKAGE_DATA_FILE" ]; then
    log_error "Package data file not found: $TEMP_PACKAGE_DATA_FILE. Cannot load data."
    # Ensure arrays are empty to prevent using stale in-memory data from a previous load or state
    packageNames=()
    directories=()
    versions=()
    unset selected_versions
    declare -A selected_versions
    return 1
  fi

  echo "Loading package data from $TEMP_PACKAGE_DATA_FILE"
  # Clear existing global arrays before loading
  packageNames=()
  directories=()
  versions=() # This will store the 'current_ver' from the file

  # Clear the global associative array selected_versions by unsetting all its keys
  for key_to_remove in "${!selected_versions[@]}"; do
    unset selected_versions["$key_to_remove"]
  done

  local i=0
  while IFS=: read -r dir name current_ver selected_ver; do
    # Skip empty or malformed lines (e.g., if name is empty)
    if [ -z "$name" ]; then
      log_warning "Skipping line with empty package name in $TEMP_PACKAGE_DATA_FILE during load."
      continue
    fi
    directories[$i]="$dir"
    packageNames[$i]="$name"
    versions[$i]="$current_ver"                # Storing the version that was current at time of writing
    selected_versions["$name"]="$selected_ver" # Storing the selected new version
    ((i++))
  done <"$TEMP_PACKAGE_DATA_FILE"
  echo "Package data loaded successfully. Processed $i package entries."
}

# Function to clean up the temporary package data file
cleanup_package_data_file() {
  if [ -f "$TEMP_PACKAGE_DATA_FILE" ]; then
    echo "Cleaning up temporary package data file: $TEMP_PACKAGE_DATA_FILE"
    rm "$TEMP_PACKAGE_DATA_FILE"
    echo "Temporary file deleted successfully."
  else
    echo "Temporary package data file not found, no cleanup needed: $TEMP_PACKAGE_DATA_FILE"
  fi
}
