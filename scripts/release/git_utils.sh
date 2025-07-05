SCRIPT_DIR=$(dirname "$0")

source "${SCRIPT_DIR}/logging_utils.sh"

is_on_staging_branch() {
  local current_branch=$(git rev-parse --abbrev-ref HEAD)
  if [ "$current_branch" != "staging" ]; then
    error_exit "You are not on the staging branch. Please switch to the staging branch before running this script."
  fi
}

check_branch_sync() {
  ## Check if the staging and master branches are synced with the origin
  echo "Fetching and checking if the staging and master branches are synced with the origin"
  # Fetch and check if the staging and master branches are synced with the origin
  git fetch origin master:tmpMaster
  git fetch origin staging:tmpStaging

  LOCAL_MASTER=$(git rev-parse master)
  REMOTE_MASTER=$(git rev-parse tmpMaster)

  LOCAL_STAGING=$(git rev-parse staging)
  REMOTE_STAGING=$(git rev-parse tmpStaging)

  # Throw if staging is not syned, otherwise we'll miss commits
  if [ $LOCAL_STAGING != $REMOTE_STAGING ]; then
    error_exit "Your local staging branch is not up to date with origin/staging. Please sync before running this script."
  fi

  if [ $LOCAL_MASTER != $REMOTE_MASTER ]; then
    warn "Your local master branch is not up to date with origin/master. Do you want to continue? (y/N):"
    read user_input
    if [[ $user_input != [yY] && $user_input != [yY][eE][sS] ]]; then
      error_exit "Please sync your local master branch with origin/master before running this script."
    fi
  fi

  # Clean up temporary branches
  git branch -D tmpMaster
  git branch -D tmpStaging
}

create_gh_deploy_pr() {
  # Check if the gh cli is installed
  if ! command -v gh &>/dev/null; then
    error_exit "gh cli could not be found. Please install it before running this script: https://cli.github.com/"
  fi

  # Check if the user is logged in to gh
  if ! gh auth status &>/dev/null; then
    error_exit "You are not logged in to gh. Please log in before running this script."
  fi

  # Check if an open PR exists from staging to master
  OPEN_PR_NUMBER=$(gh pr list --base master --state open | grep staging | awk '{print $1}')
  CREATE_PR=true
  if [ -n "$OPEN_PR_NUMBER" ]; then
    warn "An open PR from staging to master already exists. Do you still want to create a new PR? (y/N):"
    read confirm
    if [[ $confirm != [yY] && $confirm != [yY][eE][sS] ]]; then
      echo "Skipping PR creation as per user request."
      CREATE_PR=false
    fi
  fi

  if $CREATE_PR; then
    echo "Creating a PR for the staging branch"
    gh pr create --title "Deploy latest to production" --body "" --head staging --base master
    if [ $? -ne 0 ]; then
      error_exit "Failed to create PR. Exiting."
    fi
    OPEN_PR_NUMBER=$(gh pr list --base master --state open | grep staging | awk '{print $1}')
    echo "Created PR number $OPEN_PR_NUMBER"
  else
    echo "Continuing without creating a PR."
  fi
}

ask_if_release_pr_merged() {
  echo "Now please review and approve the release new versions PR to staging."
}

ask_if_master_pr_merged() {
  echo "Now please review and approve the 'Deploy latest to production' PR to master."
}

push_to_staging() {
  echo "Pushing to staging..."
  git push origin staging
}

create_new_branch() {
  local branch_name=$1
  echo "Creating new branch..."
  git checkout -b "$branch_name"
  echo "Created new branch $branch_name"
}

commit_changelogs() {
  git commit -m "Update changelogs"
}

# Function to select a branch name
select_branch() {
  echo ""
  echo "Recent branches:"
  # Get last 5 branches
  recent_branches=($(git branch --sort=-committerdate | head -n 5 | sed 's/^[ *]*//' | xargs))

  echo "Choose a branch or create a new one:"
  PS3="Select branch option (1-$((${#recent_branches[@]} + 1))): "

  options=()
  for branch in "${recent_branches[@]}"; do
    options+=("$branch")
  done
  options+=("Create new branch")

  select branch_option in "${options[@]}"; do
    if [ "$branch_option" = "Create new branch" ]; then
      read -p "Enter new branch name: " BRANCH_NAME
      break
    elif [ -n "$branch_option" ]; then
      BRANCH_NAME="$branch_option"
      break
    else
      echo "Invalid option, please try again."
    fi
  done

  echo "Using branch: $BRANCH_NAME"
  return 0
}

publish_branch_and_open_pr_to_staging() {
  # If no branch name is provided, ask the user to select one
  if [ -z "$1" ]; then
    select_branch
    branch_name="$BRANCH_NAME"
  else
    branch_name=$1
  fi

  echo "Publishing branch..."
  git push -u origin "$branch_name"
  echo "Branch $branch_name published"

  open_pr_to_staging "$branch_name" "Release new package versions"
}

open_pr_to_staging() {
  local branch_name=$1
  local title=$2
  echo "Opening PR to staging..."
  gh pr create --title "$title" --body "" --head "$branch_name" --base staging
  echo "Opened PR to staging"
}