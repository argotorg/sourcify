## before

- In the release notes, write a clear note about the `verifiedAt` change (PR 3009): `verifiedAt` now shows when the current match was verified, not when the contract got its first match. This changes the value for about 665k upgraded contracts (for example `match` -> `exact_match`) in `/v2/contract`, `/v2/contracts`, `/v2/contract/all-chains` and `/v2/verify/{verificationId}`. Clients that use `verifiedAt` as "first verified on Sourcify" get a later date for these contracts.
