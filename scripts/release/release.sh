###
### Helpers
###

source "${SCRIPT_DIR}/logging_utils.sh"

# Global declarations for package data arrays
declare -a directories
declare -a packageNames
declare -a versions          # For current versions read from file
declare -A selected_versions # For selected new versions (pkgName -> newVersion)
declare IS_GUI_EDITOR=true   # Flag to indicate if a GUI editor is selected, true by default
declare EDITOR_SELECTED=false # The editor is asked for at the first changelog edit

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

# Function to select an editor for changelog editing
select_editor() {
  # Show current editor if set
  echo ""
  if [ -n "${EDITOR}" ]; then
    echo "Current editor set to: ${EDITOR}"
  else
    echo "No editor currently set"
  fi
  echo ""

  # Always ask for editor choice
  echo "Choose an editor for editing changelogs:"
  local COLUMNS=1 # select prints one option per line
  PS3="Select editor (1-5): "
  # IS_GUI_EDITOR is true by default. Only set to false for terminal editors.
  select editor_choice in "cursor" "nano" "vim" "code" "custom"; do
    case $editor_choice in
    "cursor")
      EDITOR="cursor"
      # IS_GUI_EDITOR remains true
      break
      ;;
    "nano")
      EDITOR="nano"
      IS_GUI_EDITOR=false
      break
      ;;
    "vim")
      EDITOR="vim"
      IS_GUI_EDITOR=false
      break
      ;;
    "code")
      EDITOR="code"
      # IS_GUI_EDITOR remains true
      break
      ;;
    "custom")
      read -p "Enter the command for your preferred editor: " EDITOR
      # IS_GUI_EDITOR remains true (assuming custom might be GUI)
      break
      ;;
    *)
      echo "Invalid option, please try again."
      ;;
    esac
  done
  echo "Using $EDITOR as the editor for changelogs"
  if [ "$IS_GUI_EDITOR" = true ]; then
    echo "Note: $EDITOR might open in a new window. The script will wait for you to save and close it before proceeding with the changelog."
  fi
  EDITOR_SELECTED=true
}

# Opens a file in the selected editor and waits until the user is done
edit_file() {
  [ "$EDITOR_SELECTED" = true ] || select_editor
  ${EDITOR:-nano} "$1"
  if [ "$IS_GUI_EDITOR" = true ]; then
    echo ""
    read -n 1 -s -r -p "Changelog editor ($EDITOR) was opened. Please save your changes and close the editor, then press any key to continue..."
    echo ""
  fi
}

# For each changed package: show the changelog generated from the commits, choose the version, then confirm or edit the changelog
update_packages_and_changelog() {
  echo "Checking which packages need a new version"

  # Help by showing the PR URL
  GITHUB_REPO_FULL_NAME=$(gh repo view --json nameWithOwner -q .nameWithOwner)
  GITHUB_REPO_URL="https://github.com/${GITHUB_REPO_FULL_NAME}"
  GITHUB_PR_URL="${GITHUB_REPO_URL}/pull/${OPEN_PR_NUMBER}"
  GITHUB_PR_URL_FILES="${GITHUB_PR_URL}/files"

  # The changelogs start at each package's last release tag
  git fetch --tags --quiet origin || warn "Could not fetch the tags. The changelogs can contain commits that are already released."

  # Get the list of changed packages
  OUTPUT=$(npx lerna changed --all --long --parseable --include-merged-tags)

  if [ -z "$OUTPUT" ]; then
    echo "No packages need to be updated."
    exit 0
  fi

  # Define arrays to hold package directories, names, and versions.
  declare -a directories
  declare -a packageNames
  declare -a versions
  declare -A selected_versions

  # Use process substitution to avoid creating a subshell with a pipeline
  # Make ":" the delimiter and read the output into variables
  while IFS=: read -r directory packageName version tag; do
    directories+=("$directory")
    packageNames+=("$packageName")
    versions+=("$version")
  done < <(echo "$OUTPUT")

  echo "Packages to be updated:"
  for index in "${!directories[@]}"; do
    echo "${packageNames[$index]} at ${directories[$index]} (current version: ${versions[$index]})"
  done

  for index in "${!directories[@]}"; do
    release_package "${packageNames[$index]}" "${directories[$index]}" "${versions[$index]}"
  done

  # Write all collected package data to the temporary file
  write_package_data directories packageNames versions selected_versions
}

# Shows the generated changelog of a package, asks for its version, then writes the confirmed changelog
release_package() {
  local pkg_name=$1
  local directory=$2
  local current_version=$3
  local entries_file

  entries_file=$(mktemp)
  generate_changelog_entries "$pkg_name" "$directory" >"$entries_file"

  echo ""
  echo "=============================="
  echo "$pkg_name"
  echo "Commits since: $(last_release_tag "$pkg_name")"
  echo "Review changes at: $GITHUB_PR_URL_FILES"
  echo "=============================="
  echo "Changelog generated from the commit messages:"
  echo ""
  cat "$entries_file"
  echo ""

  select_new_version "$pkg_name" "$current_version" "$(suggest_version_bump "$pkg_name" "$directory")"
  if [ "${selected_versions["$pkg_name"]}" = "$current_version" ]; then
    echo "The version of $pkg_name does not change, so its changelog stays as it is."
  elif review_changelog_entries "$pkg_name" "$entries_file"; then
    update_changelog "$pkg_name" "$directory" "$entries_file"
  else
    echo "Skipped the changelog for $pkg_name"
  fi
  rm "$entries_file"
}

# Asks if the changelog entries are fine and opens the editor until they are. Returns 1 if the user skips.
review_changelog_entries() {
  local pkg_name=$1
  local entries_file=$2
  local answer

  while true; do
    read -p "Is the changelog of $pkg_name fine? (Y)es, (e)dit, or (s)kip writing it: " answer
    case $answer in
    [eEnN]*)
      edit_file "$entries_file"
      echo ""
      echo "## $pkg_name@${selected_versions["$pkg_name"]}"
      echo ""
      cat "$entries_file"
      echo ""
      ;;
    [sS]*) return 1 ;;
    *) return 0 ;;
    esac
  done
}

# Selects a new version for the package and writes to global selected_versions variable. Enter takes the suggested bump.
select_new_version() {
  local pkg_name=$1
  local current_version=$2
  local suggested_bump=$3
  local -a bumps=(patch minor major current)
  local -a choices=("$(increment_version "$current_version" patch)" "$(increment_version "$current_version" minor)" "$(increment_version "$current_version" major)" "$current_version")
  local -a labels=()
  local i default answer

  echo "Select a new version for $pkg_name (currently $current_version)"
  for i in "${!bumps[@]}"; do
    labels[$i]="${bumps[$i]^} (${choices[$i]})"
    if [ "${bumps[$i]}" = "$suggested_bump" ]; then
      default=$((i + 1))
      echo "$((i + 1))) ${labels[$i]} - suggested by the commit types"
    else
      echo "$((i + 1))) ${labels[$i]}"
    fi
  done

  while true; do
    read -p "Choose the new version for $pkg_name (1-4, Enter for $default): " answer
    answer=${answer:-$default}
    [[ $answer =~ ^[1-4]$ ]] && break
    echo "Invalid option, try again."
  done
  selected_versions["$pkg_name"]=${choices[$((answer - 1))]}
  echo "You selected ${labels[$((answer - 1))]}"
}

update_changelog() {
  local pkg_name=$1
  local directory=$2
  local changelog_entry_filename=$3

  today=$(date '+%Y-%m-%d')

  # Ensure the changelog entry ends with a newline
  if [ -s "$changelog_entry_filename" ] && [ -n "$(tail -c1 "$changelog_entry_filename")" ]; then
    echo "" >>"$changelog_entry_filename"
  fi

  new_changelog_heading="## $pkg_name@${selected_versions["$pkg_name"]} - $today"
  changelog_file="${directory}/CHANGELOG.md"

  # Split the changelog content around the first version header
  upper_part=$(awk '/^## [^#]/ {exit} {print}' "$changelog_file")
  lower_part=$(awk '/^## [^#]/ {print_it=1} print_it' "$changelog_file")

  # Create a new changelog content by combining parts with new entry
  {
    # Some changelogs have no title above the first version
    [ -n "$upper_part" ] && printf '%s\n\n' "$upper_part"
    echo "$new_changelog_heading"
    echo ""
    cat "$changelog_entry_filename"
    echo ""
    echo "$lower_part"
  } >"$changelog_file"

  echo "Changelog updated for $pkg_name"

  # Stage the updated changelog file for git commit
  git add "$changelog_file"
}

commit_changelogs() {
  git commit -m "Update changelogs and clear release TODOs"
}

###
### Next, set versions with lerna version.
### Must use the interactive command. There is no way to bump the version of a single package in a singel command, weirdly, https://github.com/lerna/lerna/issues/3874
###

function run_lerna_version() {
  # Load package data from the temporary file
  load_package_data_into_arrays

  ## Print the new versions before the lerna prompt for convenience
  echo "\\nNew versions for packages:"
  for pkg_name in "${!selected_versions[@]}"; do
    echo "$pkg_name: ${selected_versions[$pkg_name]}"
  done
  npx lerna version --no-push --include-merged-tags
}

###
### Next, push tags in an ordering and with delays in between
### We can't simply let lerna do this because CircleCI doesn't run when all tags are published
###
# Priority packages whose tags should be pushed first in specific order
declare -a priority_packages=("@ethereum-sourcify/bytecode-utils" "@ethereum-sourcify/compilers-types" "@ethereum-sourcify/compilers" "@ethereum-sourcify/lib-sourcify")

# Push tags one by one with a delay
push_tag() {
  local tag=$1
  echo "Pushing tag $tag..."
  git push origin "$tag"
}

# Main function to handle ordered tag pushing
push_tags_in_order() {
  # Load package data from the temporary file
  load_package_data_into_arrays

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
  # Load package data from the temporary file
  load_package_data_into_arrays

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
  # Set --latest=false unless the pkg_name is sourcify-server. In that case set explicitly --latest
  if [ "$pkg_name" == "sourcify-server" ]; then
    echo "$release_notes" | gh release create "$tag" -F - --title "$tag" --notes "$release_notes" --latest
  else
    echo "$release_notes" | gh release create "$tag" -F - --title "$tag" --notes "$release_notes" --latest=false
  fi
}
