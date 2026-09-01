# Release TODOs

A release TODO is a manual step that a person must do around a production deploy, for example:

- apply a database migration on the staging and production databases
- change a load balancer or Cloud Run setting
- add a secret or an environment variable
- run a follow-up script after a migration (see `services/database/README.md`, "schema upgrade scripts")

The release script (`scripts/release/main.sh`) reads every `.md` file in this directory except this README, shows the items at the right time, and deletes the files on the release branch. So the directory only ever holds the open items for the next release.

## When to add a file

Add a file in the same PR that creates the need. Every PR that adds a migration must add one.

## File name

`<pr-number>-<short-name>.md`, for example `2937-drop-idx-code-code-first-75.md`.

## Format

Two optional sections. `before` is shown at the start of the release, before the "Deploy latest to production" PR is created. `after` is shown once that PR is merged. A file with no headings counts as `before`.

```markdown
## before

- Run `npm run migrate:up` on the staging database
- Run `npm run migrate:up` on the production database (the drop is instant)

## after

- Delete the old Cloud Run revision
```

## Safety nets

The release script also, without any file here:

- lists new files under `services/database/migrations/` since the last deploy
- lists added lines that contain `TODO_RELEASE` since the last deploy

Both only look at `git diff master...staging`, so an item shows up for exactly one release.
