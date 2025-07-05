#!/bin/bash
SCRIPT_DIR=$(dirname "$0")

# A script to (semi)automate the Sourcify release process.

# Exit immediately if a command exits with a non-zero status.
# set -e

# Make sure the script exits if a command in a pipeline fails.
# set -o pipefail

source "${SCRIPT_DIR}/logging_utils.sh"
source "${SCRIPT_DIR}/git_utils.sh"
source "${SCRIPT_DIR}/release_data_utils.sh"
source "${SCRIPT_DIR}/release.sh"

###
### Main
###
prompt_execute_or_skip "checking current branch" is_on_staging_branch
prompt_execute_or_skip "checking if branches are in sync" check_branch_sync
prompt_execute_or_skip "creating GitHub PR" create_gh_deploy_pr

# Needed if the user skips creating the PR
if [ -z "$OPEN_PR_NUMBER" ]; then
  OPEN_PR_NUMBER=$(gh pr list --base master --state open | grep staging | awk '{print $1}')
fi

prompt_execute_or_skip "creating new branch because we can't commit to staging directly" create_new_branch "release-$(date +'%Y-%m-%d-%H-%M')" # Add hour and minute to the branch name if we do multiple releases in the same day
prompt_execute_or_skip "choosing versions for each package and writing changelogs" update_packages_and_changelog
prompt_execute_or_skip "commiting the changelogs" commit_changelogs

## Run lerna version and create git tags
prompt_execute_or_skip "choosing same versions in lerna to create git tags and updating dependencies" run_lerna_version
prompt_execute_or_skip "publishing the branch" publish_branch_and_open_pr_to_staging

prompt_execute_or_skip "asking if release PR is merged" ask_if_release_pr_merged
prompt_execute_or_skip "pushing the tags to GitHub" push_tags_in_order
prompt_execute_or_skip "creating GitHub releases" create_github_releases

prompt_execute_or_skip "asking if 'Deploy latest to production' PR is merged" ask_if_master_pr_merged

# Clean up the temporary package data file
prompt_execute_or_skip "cleaning up temporary release data" cleanup_package_data_file
