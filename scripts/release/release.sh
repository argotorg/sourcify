###
### Helpers
###

source "${SCRIPT_DIR}/logging_utils.sh"

# Function to parse and increment version
increment_version() {
  local version=$1
  local inc_type=$2
  local IFS='.'
  local parts=($version)
  case "$inc_type" in
  "patch")
    parts[2]=$((${parts[2]} + 1))
    ;;
  "minor")
    parts[1]=$((${parts[1]} + 1))
    parts[2]=0
    ;;
  "major")
    parts[0]=$((${parts[0]} + 1))
    parts[1]=0
    parts[2]=0
    ;;
  esac
  echo "${parts[0]}.${parts[1]}.${parts[2]}"
}

## Check which packages need an update and write them to the global variables directories, packageNames, versions
check_packages_for_update() {
  echo "Checking which packages need a new version"

  GITHUB_REPO_FULL_NAME=$(gh repo view --json nameWithOwner -q .nameWithOwner)
  GITHUB_REPO_URL="https://github.com/${GITHUB_REPO_FULL_NAME}"
  GITHUB_PR_URL="${GITHUB_REPO_URL}/pull/${OPEN_PR_NUMBER}"
  GITHUB_PR_URL_FILES="${GITHUB_PR_URL}/files"

  # Get the list of changed packages
  OUTPUT=$(npx lerna changed --all --long --parseable)

  if [ -z "$OUTPUT" ]; then
    echo "No packages need to be updated."
    exit 0
  fi

  # Use process substitution to avoid creating a subshell with a pipeline
  while IFS=: read -r directory packageName version tag; do
    directories+=("$directory")
    packageNames+=("$packageName")
    versions+=("$version")
  done < <(echo "$OUTPUT")
}

# For each directory/package to be updated decide on patch, minor, or major, and then ask for changelog input
update_packages_and_changelog() {
  echo "Packages to be updated:"
  for index in "${!directories[@]}"; do
    echo "${packageNames[$index]} at ${directories[$index]} (current version: ${versions[$index]})"
  done

  for index in "${!directories[@]}"; do
    pkg_name="${packageNames[$index]}"
    current_version="${versions[$index]}"

    prompt_execute_or_skip "selecting a version for $pkg_name" select_new_version "$pkg_name" "$current_version"
    prompt_execute_or_skip "updating the chagelog for $pkg_name" update_changelog "$pkg_name" "${directories[$index]}"
  done
}

# Selects a new version for the package and writes to global selected_versions variable
select_new_version() {
  local pkg_name=$1
  local current_version=$2

  new_patch=$(increment_version "$current_version" "patch")
  new_minor=$(increment_version "$current_version" "minor")
  new_major=$(increment_version "$current_version" "major")

  echo ""
  echo "=============================="
  echo "$pkg_name"
  echo "Review changes at: $GITHUB_PR_URL_FILES"
  echo "=============================="
  echo "Select a new version for $pkg_name (currently $current_version)"
  PS3="Choose the new version for $pkg_name (1, 2, or 3): "
  select version_type in "Patch ($new_patch)" "Minor ($new_minor)" "Major ($new_major)"; do
    case $version_type in
    "Patch ($new_patch)")
      echo "You selected $version_type"
      selected_versions["$pkg_name"]=$new_patch
      break
      ;;
    "Minor ($new_minor)")
      echo "You selected $version_type"
      selected_versions["$pkg_name"]=$new_minor
      break
      ;;
    "Major ($new_major)")
      echo "You selected $version_type"
      selected_versions["$pkg_name"]=$new_major
      break
      ;;
    *)
      echo "Invalid option, try again."
      ;;
    esac
  done
}

update_changelog() {
  local pkg_name=$1
  local directory=$2

  today=$(date '+%Y-%m-%d')
  changelog_entry_filename=$(mktemp)

  # Prompt the user to enter changelog details in their default editor
  ${EDITOR:-nano} "$changelog_entry_filename"
  new_changelog_heading="## $pkg_name@${selected_versions["$pkg_name"]} - $today"
  changelog_file="${directory}/CHANGELOG.md"

  # Split the changelog content around the first version header
  upper_part=$(awk '/^## [^#]/ {exit} {print}' "$changelog_file")
  lower_part=$(awk '/^## [^#]/ {print_it=1} print_it' "$changelog_file")

  # Create a new changelog content by combining parts with new entry
  {
    echo "$upper_part"
    echo ""
    echo "$new_changelog_heading"
    echo ""
    cat "$changelog_entry_filename"
    echo ""
    echo "$lower_part"
  } >"$changelog_file"

  # Clean up the temporary file used for user input
  rm "$changelog_entry_filename"

  echo "Changelog updated for $pkg_name"

  # Stage the updated changelog file for git commit
  git add "$changelog_file"
}

commit_changelogs() {
  git commit -m "Update changelogs"
}

###
### Next, set versions with lerna version.
### Must use the interactive command. There is no way to bump the version of a single package in a singel command, weirdly, https://github.com/lerna/lerna/issues/3874
###

function run_lerna_version() {
  ## Print the new versions before the lerna prompt for convenience
  echo "\\nNew versions for packages:"
  for pkg_name in "${!selected_versions[@]}"; do
    echo "$pkg_name: ${selected_versions[$pkg_name]}"
  done
  npx lerna version --no-push
}

###
### Next, push tags in an ordering and with delays in between
### We can't simply let lerna do this because CircleCI doesn't run when all tags are published
###
# Priority packages whose tags should be pushed first in specific order
declare -a priority_packages=("@ethereum-sourcify/bytecode-utils" "@ethereum-sourcify/contract-call-decoder" "@ethereum-sourcify/lib-sourcify")

# Push tags one by one with a delay
push_tag() {
  local tag=$1
  echo "Pushing tag $tag..."
  git push origin "$tag"
}

# Main function to handle ordered tag pushing
push_tags_in_order() {
  # Push priority tags first in the defined order
  for package in "${priority_packages[@]}"; do
    for pkg_index in "${!packageNames[@]}"; do
      pkg_name="${packageNames[$pkg_index]}"
      package_dir="${directories[$pkg_index]}"
      if [[ "$pkg_name" == *"$package"* ]]; then
        tag="$pkg_name@${selected_versions[$pkg_name]}"
        prompt_execute_or_skip "Pushing tag $tag to GitHub" push_tag "$tag"
      fi
    done
  done
  # Push remaining tags
  for pkg_name in "${!selected_versions[@]}"; do
    if [[ ! " ${priority_packages[*]} " =~ "$pkg_name" ]]; then
      tag="$pkg_name@${selected_versions[$pkg_name]}"

      prompt_execute_or_skip "Pushing tag $tag to GitHub" push_tag "$tag"

    fi
  done
}

###
### Github releases
###

create_github_releases() {
  echo "Creating GitHub releases..."
  # Loop through each package to create a GitHub release
  for pkg_index in "${!packageNames[@]}"; do
    create_individual_release "$pkg_index"
  done
}

create_individual_release() {
  pkg_index=$1
  pkg_name="${packageNames[$pkg_index]}"
  version="${selected_versions[$pkg_name]}"
  tag="$pkg_name@$version"
  directory="${directories[$pkg_index]}"
  changelog_file="$directory/CHANGELOG.md"

  # Extract the changelog entry for the new version
  release_notes=$(extract_release_notes "$pkg_name" "$version" "$changelog_file")

  # Use gh CLI to create a release
  echo "\\nCreating release for $tag with notes from $changelog_file..."
  echo "$release_notes"

  prompt_execute_or_skip "creating GitHub release for $tag" create_gh_release "$pkg_name" "$tag" "$release_notes"

  echo "Release created for $tag"
}

extract_release_notes() {
  pkg_name=$1
  version=$2
  changelog_file=$3
  # This awk command captures the changelog block starting with the version tag until the next version tag starts
  awk -v tag="## $pkg_name@$version" 'p && /^## /{exit} /^## /{p=0} $0 ~ tag{p=1} p' "$changelog_file"
}

create_gh_release() {
  pkg_name=$1
  tag=$2
  release_notes=$3
  # Set --latest=false unless the pkg_name is sourcify-monorepo. In that case set explicitly --latest
  if [ "$pkg_name" == "sourcify-monorepo" ]; then
    echo "$release_notes" | gh release create "$tag" -F - --title "$tag" --notes "$release_notes" --latest
  else
    echo "$release_notes" | gh release create "$tag" -F - --title "$tag" --notes "$release_notes" --latest=false
  fi
}
