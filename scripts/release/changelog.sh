#!/bin/bash
# Changelog entries generated from commit subjects.
#
# The entries for a package are the subjects of the commits on staging (one per PR) that
# changed its directory since its last release, oldest first. Renovate commits
# ("fix(deps): ...") become one "Update dependencies" line at the end.

# Renovate commit subjects, e.g. "fix(deps): update all patch and minor dependencies (#3041)".
DEPS_COMMIT_REGEX='^[a-z]+\(deps(-dev)?\)!?: '
# Commits of a release itself, including the merge of the release PR.
RELEASE_COMMIT_REGEX='^(chore\(release\): publish|Update changelogs|Release new package versions)'

# Last release tag of a package in the history of a ref, e.g. sourcify-server@4.2.0. Empty if there is none.
last_release_tag() {
  git describe --tags --abbrev=0 --match "$1@*" "${2:-HEAD}" 2>/dev/null
}

# Package directory relative to the repository root (lerna gives absolute paths).
relative_package_dir() {
  local top
  top=$(git rev-parse --show-toplevel)
  echo "${1#"$top"/}"
}

# Version in the package.json of a package directory at a ref.
package_version() {
  git -C "$(git rev-parse --show-toplevel)" show "$2:$1/package.json" |
    node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version'
}

# Tag where the changelog of a package starts: the tag of its version in package.json.
# That tag is outside the history if the release PR was squash-merged, so it is not found with git describe.
# If the tag does not exist, the last release tag in the history.
# Args: package name, package directory, end ref (default HEAD)
changelog_start_tag() {
  local tag
  tag="$1@$(package_version "$(relative_package_dir "$2")" "${3:-HEAD}")"
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "$tag"
  else
    last_release_tag "$1" "${3:-HEAD}"
  fi
}

# Prints the package commits since its last release, oldest first.
# Args: package name, package directory, end ref, git log options
package_commits() {
  local pkg_name=$1 dir to=$3 tag
  dir=$(relative_package_dir "$2")
  tag=$(changelog_start_tag "$pkg_name" "$dir" "$to")
  [ -z "$tag" ] && return
  # Changelog-only commits are not changes
  git -C "$(git rev-parse --show-toplevel)" log --reverse "${@:4}" "$tag..$to" \
    -- "$dir" ":(exclude)$dir/CHANGELOG.md"
}

# Prints the changelog entries for a package, one "- " line each.
# Args: package name, package directory, end ref (default HEAD)
generate_changelog_entries() {
  local subjects
  if [ -z "$(changelog_start_tag "$1" "$2" "${3:-HEAD}")" ]; then
    echo "- Initial release"
    return
  fi
  # --first-parent: one line per PR, also for PRs merged with a merge commit
  subjects=$(package_commits "$1" "$2" "${3:-HEAD}" --first-parent --format=%s | grep -vE "$RELEASE_COMMIT_REGEX")
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
  # All commits, so that the commits inside a PR merged with a merge commit also count
  subjects=$(package_commits "$1" "$2" "${3:-HEAD}" --format=%s)
  if grep -qE '^[a-z]+(\([^)]*\))?!: ' <<<"$subjects" ||
    package_commits "$1" "$2" "${3:-HEAD}" --format=%B | grep -qE '^BREAKING[ -]CHANGE: '; then
    echo major
  elif grep -qE '^feat(\([^)]*\))?: ' <<<"$subjects"; then
    echo minor
  else
    echo patch
  fi
}
