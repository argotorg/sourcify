## before

- Make sure repo.sourcify.dev handles the new `429` `similarity_recently_failed` code (show the failed state, do not poll) before this release reaches production. Today it treats every `429` as a running job and polls `/v2/contract` for 5 minutes.
