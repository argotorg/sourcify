#!/bin/bash
# Changelog entries generated from commit subjects.
#
# The entries for a package are the subjects of the commits that changed its directory
# since its last release tag, oldest first. Renovate commits ("fix(deps): ...") become
# one "Update dependencies" line at the end.

# Renovate commit subjects, e.g. "fix(deps): update all patch and minor dependencies (#3041)".
DEPS_COMMIT_REGEX='^[a-z]+\(deps(-dev)?\)!?: '
# Commits of a release itself, in case a range contains them.
RELEASE_COMMIT_REGEX='^(chore\(release\): publish|Update changelogs)'

# Last release tag of a package, e.g. sourcify-server@4.2.0. Empty if the package has none.
last_release_tag() {
  git describe --tags --abbrev=0 --match "$1@*" "${2:-HEAD}" 2>/dev/null
}

# Package directory relative to the repository root (lerna gives absolute paths).
relative_package_dir() {
  local top
  top=$(git rev-parse --show-toplevel)
  echo "${1#"$top"/}"
}

# Prints the full messages (with -b) or the subjects of the package commits since its last release tag.
# Args: package name, package directory, end ref (default HEAD), optional -b
package_commits() {
  local pkg_name=$1 dir to=${3:-HEAD} format=%s tag
  dir=$(relative_package_dir "$2")
  [ "$4" = "-b" ] && format=%B
  tag=$(last_release_tag "$pkg_name" "$to")
  [ -z "$tag" ] && return
  # Commits that only edit the changelog are not changes.
  git -C "$(git rev-parse --show-toplevel)" log --no-merges --reverse --format="$format" "$tag..$to" \
    -- "$dir" ":(exclude)$dir/CHANGELOG.md"
}

# Prints the changelog entries for a package, one "- " line each.
# Args: package name, package directory, end ref (default HEAD)
generate_changelog_entries() {
  local subjects
  if [ -z "$(last_release_tag "$1" "${3:-HEAD}")" ]; then
    echo "- Initial release"
    return
  fi
  subjects=$(package_commits "$1" "$2" "${3:-HEAD}" | grep -vE "$RELEASE_COMMIT_REGEX")
  grep -vE "$DEPS_COMMIT_REGEX" <<<"$subjects" | grep . | sed 's/^/- /'
  # No commits: lerna bumps the package because a monorepo dependency changed.
  if [ -z "$subjects" ] || grep -qE "$DEPS_COMMIT_REGEX" <<<"$subjects"; then
    echo "- Update dependencies"
  fi
}

# Prints the Conventional Commits bump for a package: major, minor or patch.
# Args: package name, package directory, end ref (default HEAD)
suggest_version_bump() {
  local subjects
  subjects=$(package_commits "$1" "$2" "${3:-HEAD}")
  if grep -qE '^[a-z]+(\([^)]*\))?!: ' <<<"$subjects" ||
    package_commits "$1" "$2" "${3:-HEAD}" -b | grep -qE '^BREAKING[ -]CHANGE: '; then
    echo major
  elif grep -qE '^feat(\([^)]*\))?: ' <<<"$subjects"; then
    echo minor
  else
    echo patch
  fi
}
