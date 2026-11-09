# Contributing to Sourcify

Thank you for your interest in Sourcify. This page explains how you can help, and what we ask from you.

**Short version:** please open an issue, not a pull request. A good issue helps us more than a pull request does. The sections below explain why.

## Where to go

| You want to...                                                | Go to                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ask a question, or get help with a contract that won't verify | [Discord](https://discord.com/invite/6aqd9cfZ9s), [Matrix](https://matrix.to/#/#ethereum_source-verify:gitter.im), or email [hello@sourcify.dev](mailto:hello@sourcify.dev)                                              |
| Report a bug                                                  | [Open a bug report](https://github.com/argotorg/sourcify/issues/new?template=bug_report.yml)                                                                                                                             |
| Request a feature                                             | [Open a feature request](https://github.com/argotorg/sourcify/issues/new?template=feature_request.yml)                                                                                                                   |
| Add support for a new chain                                   | Follow the [chain support instructions](https://docs.sourcify.dev/docs/chain-support/). Chains are configured in [sourcify-chains](https://github.com/sourcifyeth/sourcify-chains), and pull requests are welcome there. |
| List your self-hosted Sourcify instance on sourcify.dev       | [Use the self-hosted instance template](https://github.com/argotorg/sourcify/issues/new?template=self-hosted-instance.md)                                                                                                |
| Report a security problem                                     | See [SECURITY.md](./SECURITY.md). Do not open a public issue.                                                                                                                                                            |

You can see what we are working on in our [public issue board](https://github.com/orgs/argotorg/projects/33).

## Issues first, pull requests only when needed

We prefer issues over pull requests from outside contributors. This is not because we don't value your help. It is because of where the work is.

With today's AI tools, it costs us almost nothing to write a fix. The expensive part is to understand the problem, to decide what the correct fix is, and to make sure that the fix is correct. A pull request from someone we don't know adds review work to this. It does not remove the hard part. If we decide to fix something, we usually write the fix ourselves, even if a pull request for it exists.

What helps us most is a clear issue:

- **A way to reproduce the problem.** For verification problems, give the chain ID, the contract address, and the verification job ID if you have one.
- **What you expected, and what happened.**
- **Your analysis of the cause**, if you looked into it.
- **A proposed approach**, if you have one. A prompt that you would give to an AI agent is fine.

### When a pull request makes sense

You can still open a pull request. It makes sense when:

- we know you, or you have contributed before,
- we asked for a pull request on an issue, or
- you think the change really needs code to explain it, for example as a proof of concept.

If you open a pull request, please link an issue first. Please don't be offended if we close the pull request, or rewrite the change from scratch.

### Pull request checklist

- Target the `staging` branch. Only `staging` merges into `master`.
- Keep one change per pull request.
- Run the linter and the tests: `npm run lerna-lint` and `npm run lerna-test` from the repository root. See [Common Commands in AGENTS.md](./AGENTS.md#common-commands) for the commands of each service and package.
- If you add a database migration, also commit the updated schema dump and add a file in [`.release-todos/`](./.release-todos/README.md).
- If you change the API, update the OpenAPI spec in `services/server/src/apiv2.yaml`.

## Using AI tools

You can use AI tools. We use them too. We ask that:

- **You disclose it.** Say which tool you used and how much of the change it wrote.
- **You understand your contribution.** You must be able to explain every line without the tool. If you can't, please open an issue instead.
- **You keep issues and comments short.** Edit AI-written text before you post it. Remove repetition and filler.
- **A human approves every post.** Don't let an agent open issues, pull requests, or comments on its own.

## No rewards

Sourcify does not reward contributions with tokens, airdrops, bounties, or payments. We close pull requests whose only purpose is to add a name to the contributor list.

## Licensing

Sourcify is under the [MIT License](./LICENSE). By contributing, you agree that your contribution is under the same license. You also confirm that you have the right to submit it. This includes code that an AI tool produced: make sure that it doesn't copy code under a license that is not compatible.

## What to expect

We are a small team. We can't reply to every issue quickly, and we can't fix every issue. We may close issues or pull requests without a detailed explanation. We may also reply with the help of our own AI tools.

## Code of conduct

Everyone who takes part in this project must follow our [Code of Conduct](./CODE_OF_CONDUCT.md).
