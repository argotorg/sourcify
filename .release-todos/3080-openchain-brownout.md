## before

- The first brownout window of `api.openchain.xyz` is on 2026-12-08 at 14:00 UTC (`services/4byte/src/brownoutSchedule.ts`). If this release goes to production after that date, move the windows first.

## after

- Check the old host: `curl -s -o /dev/null -D - "https://api.openchain.xyz/signature-database/v1/lookup?function=0xa9059cbb"` must show the `Deprecation` and `Sunset` headers. This shows that the `Host` header reaches the 4byte service.
- Check that the new host is not affected: the same request on `https://api.4byte.sourcify.dev` must answer `200` without a `Deprecation` header.
- Before 2027-02-23 (permanent shutdown): change the `4byte-requests-sample` log exclusion so that it also samples the `503` lines of the old host (about 260 million lines a month).
