# Recovery from transient provider GraphQL failures

The 2026-10-01 07:01 UTC failure returned HTTP 200 with internal provider station-service `socket hang up` errors. No Retry-After or rate-limit response was recorded. Our blanket `GRAPHQL_ERROR` policy disabled nationwide collection indefinitely and imposed a one-hour shared cooldown. City collection recovered after that cooldown; nationwide collection required explicit re-enabling.

## Change

The national transport now inspects the complete GraphQL error list before truncating diagnostic messages. Recognized connection failures and bare 408/502/503/504 messages become `UPSTREAM_TRANSIENT_GRAPHQL`, with a minimum 60-second shared cooldown (longer Retry-After remains authoritative). The existing queue retries automatically, with at most three attempts per job, unchanged hourly request/lookup budgets, regional ownership, and campaign end time. A failed response is still rejected in full; partial prices are never published as a successful batch.

Access denials dominate mixed error lists and still stop collection. Explicit rate denials, including those carried by HTTP 200 GraphQL responses, follow the existing shared 429 backoff. Unrecognized GraphQL errors still require review. No headers, identities, IP routing, production prices, or ranking were changed.

## Deployment and recovery

Deployed the shared transport to `fuel-national-east`, `fuel-national-southwest`, and `fuel-national-northwest`. `resume.sql` records the user's authorization and guards the exact original incident, expired cooldown, and absence of new denials before enabling the existing campaign. Original missed jobs and error evidence remain intact. The existing cron resumed at 13:50 UTC; no duplicate/manual provider collection was launched.

The 07:00 UTC sweep retained 7/72 batches. The 08:00–12:00 UTC sweeps were not created while disabled and are genuine coverage gaps. The recovery-hour sweep starts late and may end partial at its original deadline. No historical observations are fabricated or backfilled with current prices.

## Verification

- 27 focused Node tests passed: transport, error classification, worker archival behavior, geography, pacing, rate limits, and archive integrity.
- `tests/nationalTransientRetry.integration.sql` passed against the protected live database: transient retry stays enabled, shared cooldown blocks other regions, attempts are capped, longer Retry-After is preserved, and access denials stop collection. All fixture changes rolled back; no provider calls or archive writes.
- Six deployed region checks passed, including deliberate wrong-region health calls rejected before touching the provider (`regions.json`).
- `live-recovery.json` records the observed resumed collection and original incident evidence. A successful restart is distinct from a complete nationwide hour.

These are provider observations, not verified pump truth. The fixed catalog's documented Texas/DC assumptions and original seven-day deadline remain unchanged.

## Live recovery result at 13:53 UTC

The scheduled sweep has archived 15/72 batches (28,213 station observations) across all three required regions, with zero wrong-region jobs and no new failure events. City collection has 480 successful checks and zero missed jobs. The new nationwide sweep is still in progress, and its late start means this does not establish full-hour coverage.

Read back and verified four immutable archives: one from each region plus the exact 2,000-ID batch (ordinal 62) that caused the original shutdown. The formerly failing batch succeeded with HTTP 200 in 2.76 seconds using the original header configuration. All four archives passed hash, size, exact ordered station IDs, price schema, priced counts, actual observation times, and regional provenance checks. See `archive-readback.json` and `national-health.json`.
