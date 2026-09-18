#!/bin/bash
# Release TODOs: manual steps that must happen around a production deploy.
#
# Three sources, all scoped to what is new for production (git diff master...staging):
#   1. Files in .release-todos/ (see .release-todos/README.md). Each file can have a
#      "## before" and an "## after" section. "before" items are shown at the start of
#      the release, "after" items once the deploy PR is merged.
#   2. New migration files under services/database/ (always a "before" item).
#   3. Added lines containing TODO_RELEASE anywhere in the diff (safety net).
#
# The notes are read from the staging commit recorded at the start of the release, so
# deleting them on the release branch or pulling staging in between loses nothing.

source "${SCRIPT_DIR}/logging_utils.sh"

RELEASE_TODOS_DIR=".release-todos"
# Holds that staging commit; a branch moves when it is pulled, a commit does not.
RELEASE_TODOS_REF_FILE="${SCRIPT_DIR}/.release_todos_ref.tmp"
# Collected "before" text; used as the body of the deploy PR.
RELEASE_TODO_TEXT=""

# Release-todo files at the given commit or branch.
todo_files_at() {
  git ls-tree --name-only "$1" "$RELEASE_TODOS_DIR/" | grep '\.md$' | grep -v '/README\.md$'
}

# The recorded commit, or the staging branch if nothing was recorded.
release_todos_ref() {
  [ -s "$RELEASE_TODOS_REF_FILE" ] && cat "$RELEASE_TODOS_REF_FILE" || echo staging
}

# Records the staging commit, unless staging has no notes left (a re-run after the release deleted them).
pin_release_todos_ref() {
  [ -n "$(todo_files_at staging)" ] && git rev-parse staging >"$RELEASE_TODOS_REF_FILE"
  return 0
}

release_todo_files() {
  todo_files_at "$(release_todos_ref)"
}

# Prints the given section ("before" or "after") of a release-todo file.
# A file with no "## before"/"## after" headings counts as "before".
todo_section() {
  local content section=$2
  content=$(git show "$(release_todos_ref):$1")
  if ! grep -qiE '^## *(before|after) *$' <<<"$content"; then
    [ "$section" = "before" ] && echo "$content"
    return
  fi
  awk -v want="$section" '
    /^## / { on = (tolower($2) == want); next }
    on { print }
  ' <<<"$content"
}

# "after" items of all release-todo files, under one "### <file>" heading each.
release_todos_after() {
  local file after
  for file in $(release_todo_files); do
    after=$(todo_section "$file" after)
    [ -n "$after" ] && printf '### %s\n%s\n\n' "$(basename "$file")" "$after"
  done
}

confirm_or_exit() {
  local question=$1
  read -p "$question (y/N): " ok
  [[ $ok == [yY] || $ok == [yY][eE][sS] ]] || error_exit "Finish the release TODOs first, then run the script again."
}

check_new_migrations() {
  local files
  files=$(git diff --name-only master...staging -- services/database/migrations/ services/database/database-specs)
  [ -z "$files" ] && return
  warn "New database migrations since the last production deploy:"
  echo "$files"
  echo "Run 'npm run migrate:up' (services/database) against the staging and production databases."
  RELEASE_TODO_TEXT+=$'\n## New migrations (apply on staging and production)\n'"$files"$'\n'
  confirm_or_exit "Applied on staging AND production?"
}

check_release_todo_files() {
  local file before after
  # A for loop, not while-read: confirm_or_exit reads stdin.
  for file in $(release_todo_files); do
    before=$(todo_section "$file" before)
    [ -z "$before" ] && continue
    warn "Release TODO ($file), before the deploy:"
    echo "$before"
    RELEASE_TODO_TEXT+=$'\n## Before deploy: '"$(basename "$file")"$'\n'"$before"$'\n'
    confirm_or_exit "Done?"
  done
  after=$(release_todos_after)
  if [ -n "$after" ]; then
    RELEASE_TODO_TEXT+=$'\n## After deploy\n'"$after"$'\n'
  fi
}

check_release_todo_markers() {
  local hits
  # The release tooling mentions TODO_RELEASE itself.
  hits=$(git diff master...staging -U0 -- ":(exclude)scripts/release" ":(exclude)$RELEASE_TODOS_DIR" | awk '
    /^\+\+\+ / { file = substr($2, 3); next }
    /^\+/ && /TODO_RELEASE/ { print file ": " substr($0, 2) }
  ')
  [ -z "$hits" ] && return
  warn "TODO_RELEASE markers in changes since the last production deploy:"
  echo "$hits"
  RELEASE_TODO_TEXT+=$'\n## TODO_RELEASE markers\n'"$hits"$'\n'
  confirm_or_exit "All of these done?"
}

# Runs at the start of the release, before the deploy PR is created.
check_release_todos() {
  pin_release_todos_ref
  check_new_migrations
  check_release_todo_files
  check_release_todo_markers
  if [ -z "$RELEASE_TODO_TEXT" ]; then
    echo "No open release TODOs."
  fi
}

# Deletes the release-todo files and stages the deletion for the release branch commit.
clear_release_todo_files() {
  local file
  for file in $(release_todo_files); do
    [ -f "$file" ] || continue
    git rm -q "$file"
    echo "Removed $file"
  done
}

# Runs at the end of the release, after the deploy PR is merged.
show_release_todos_after() {
  local after
  after=$(release_todos_after)
  if [ -z "$after" ]; then
    echo "No release TODOs for after the deploy. If you expected some, see the body of the 'Deploy latest to production' PR."
    return
  fi
  warn "Release TODOs to do now, after the deploy:"
  echo "$after"
  confirm_or_exit "All done?"
}

cleanup_release_todos_file() {
  [ -f "$RELEASE_TODOS_REF_FILE" ] && rm "$RELEASE_TODOS_REF_FILE"
  return 0
}
