#!/bin/bash
# Release TODOs: manual steps that must happen around a production deploy.
#
# Three sources, all scoped to what is new for production (git diff master...staging):
#   1. Files in .release-todos/ (see .release-todos/README.md). Each file can have a
#      "## before" and an "## after" section. "before" items are shown at the start of
#      the release, "after" items once the deploy PR is merged.
#   2. New migration files under services/database/ (always a "before" item).
#   3. Added lines containing TODO_RELEASE anywhere in the diff (safety net).

source "${SCRIPT_DIR}/logging_utils.sh"

RELEASE_TODOS_DIR=".release-todos"
# Persists "after" items across script steps, like .release_package_data.tmp does for packages.
RELEASE_TODOS_AFTER_FILE="${SCRIPT_DIR}/.release_todos_after.tmp"
# Collected "before" text; used as the body of the deploy PR.
RELEASE_TODO_TEXT=""

# Prints the given section of a release-todo file ("before" or "after").
# A file with no "## before"/"## after" headings counts as "before".
todo_section() {
  local file=$1
  local section=$2
  if ! grep -qiE '^## *(before|after) *$' "$file"; then
    [ "$section" = "before" ] && cat "$file"
    return
  fi
  awk -v want="$section" '
    /^## / { on = (tolower($2) == want); next }
    on { print }
  ' "$file"
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
  local file
  >"$RELEASE_TODOS_AFTER_FILE"
  for file in "$RELEASE_TODOS_DIR"/*.md; do
    [ -f "$file" ] || continue
    [ "$(basename "$file")" = "README.md" ] && continue
    local before after
    before=$(todo_section "$file" before)
    after=$(todo_section "$file" after)
    if [ -n "$after" ]; then
      printf '### %s\n%s\n\n' "$(basename "$file")" "$after" >>"$RELEASE_TODOS_AFTER_FILE"
    fi
    [ -z "$before" ] && continue
    warn "Release TODO ($file), before the deploy:"
    echo "$before"
    RELEASE_TODO_TEXT+=$'\n## Before deploy: '"$(basename "$file")"$'\n'"$before"$'\n'
    confirm_or_exit "Done?"
  done
  if [ -s "$RELEASE_TODOS_AFTER_FILE" ]; then
    RELEASE_TODO_TEXT+=$'\n## After deploy\n'"$(cat "$RELEASE_TODOS_AFTER_FILE")"$'\n'
  fi
}

check_release_todo_markers() {
  local hits
  hits=$(git diff master...staging -U0 | awk '
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
  for file in "$RELEASE_TODOS_DIR"/*.md; do
    [ -f "$file" ] || continue
    [ "$(basename "$file")" = "README.md" ] && continue
    git rm -q "$file"
    echo "Removed $file"
  done
}

# Runs at the end of the release, after the deploy PR is merged.
show_release_todos_after() {
  if [ ! -s "$RELEASE_TODOS_AFTER_FILE" ]; then
    echo "No release TODOs for after the deploy."
    return
  fi
  warn "Release TODOs to do now, after the deploy:"
  cat "$RELEASE_TODOS_AFTER_FILE"
  confirm_or_exit "All done?"
}

cleanup_release_todos_file() {
  [ -f "$RELEASE_TODOS_AFTER_FILE" ] && rm "$RELEASE_TODOS_AFTER_FILE"
  return 0
}
