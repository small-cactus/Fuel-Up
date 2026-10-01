# Header diagnosis and authorized collection recovery

At the user's request, tested the existing `gbcsrf` value, header omission, and a
single fixed plain placeholder (`fuelup-research`). All diagnostic requests ran
in Supabase **us-east-1**, verified both inside the function and through the
gateway response. No cookies were explicitly sent or retained. Regional pinning
does not guarantee identical outbound IPs across invocations.

## Observed results

| Request | UTC start | HTTP | Elapsed | Result |
| --- | --- | --- | --- | --- |
| Existing configured header, one station | 00:29:32 | 200 | 115 ms | Valid prices |
| GET `/home`, token-source inspection | 00:29:47 | 403 | 14 ms | Cloudflare challenge; stopped page inspection |
| Same station/query, `gbcsrf` omitted | 00:30:26 | 400 | 66 ms | `Bad Request` |
| Same station/query, `gbcsrf: fuelup-research` | 00:31:03 | 200 | 145 ms | Identical station/prices to control |
| Original failed 2,000-ID batch, original configured header | 00:31:59 | 200 | 2,602 ms | All 2,000 stations archived successfully |

The narrow inference is that this tested public price query accepts a non-session
placeholder but rejects omission. This does **not** establish the exact server
validation rule, absence of header-based rate accounting, earliest recovery time,
or the production quota. The homepage challenge is a separate endpoint result;
no challenge solving or alternate route to the page was attempted. No fresh
page-issued token was available, so that comparison was not performed.

Three price diagnostics used this identical query and variables `{}`:

```graphql
query HeaderDiagnostic {
  station(id: "138294") {
    id
    prices { fuelProduct cash { price postedTime } credit { price postedTime } }
  }
}
```

The station is from the original failed East batch. Request headers were the
existing `buildGasBuddyGraphQLRequest` headers; only `gbcsrf` changed. The worker
configured value came from `GASBUDDY_CSRF` with the existing source fallback.
Tokens, cookies, and authentication secrets were excluded from the reports.
The temporary authenticated, region-pinned diagnostic endpoint expired at
00:45 UTC and was **deleted immediately after the four requests**. It has no cron.

## Header origin

GasBuddy's own public React client explicitly forwards `window.gbcsrf` as the
`gbcsrf` request header:
[fetchApi.js, pinned source](https://github.com/gas-buddy/react/blob/9b38b87801b4f8c56b48e85a080fe93dec2385ae/src/fetchApi.js#L23).
Their public web-app package can generate a version prefix plus 12 random bytes,
assign a CSRF cookie, and compare the supplied value with a reference/cookie:
[csrf.ts, pinned source](https://github.com/gas-buddy/web-app/blob/80798e65f98a93087b10824ca14b8de2d5e24cea/src/csrf.ts).
Its configuration and deployment on the current public GraphQL endpoint are
unverified; the placeholder success must not be represented as proof that this
exact validator is enabled there.

Our hardcoded fallback is present in repository commit `bd62d55` dated April 23,
2026. Git history does not establish which original browser session supplied it.
No production header or secret was changed during this investigation.

## Recovery and remaining limitation

The original error was HTTP 200 with saved `408` GraphQL messages, not HTTP 429;
no Retry-After was returned. Our handler imposed the one-hour backoff and disabled
collection. The user explicitly requested removing that pause and trying again.
`resume.sql` was executed once with guards matching the precise incident state;
it preserved failure events and attempt counts, cleared only that incident's
shared backoff, and restored the existing bounded schedule. Database event 21
records the authorization/recovery and all diagnostic request counts.

Job 8710 succeeded on attempt two with the original header, in its original
region. Its immutable archive was downloaded and checked against the manifest
SHA-256, station count, and region (`retried-batch-audit.json`). At 00:33:10 UTC the
national hour had advanced from 25 to 31 completed batches; city successes had
advanced from 144 to 148, with zero recorded missed city slots. The hour was still
in progress. No old observations were overwritten or backdated, and the October
7 deadline remains unchanged.

The recovery supports a transient provider failure as an explanation; it does
not prove the underlying cause. The existing broad GraphQL hard-stop policy is
unchanged and can pause again. Separately classifying transient field errors
requires fuller error paths/codes and bounded retry tests, not just treating
every unknown GraphQL error as safe.

Evidence: `probe.json`, `omission.json`, `placeholder.json`, `recovery.json`,
`retried-batch-audit.json`, and `status-after-resume.json`.
