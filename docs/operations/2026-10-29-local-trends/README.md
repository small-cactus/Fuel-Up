# Local Trends on first launch

Local remains the default scope. Its old `station_prices` query depended on rounded search locations and a retired writer (latest row October 1; no rows in the previous 14 days). The live nationwide collector holds individual nearby station observations, but the existing compact national totals cannot reconstruct local history.

The new private daily station index derives original fresh-at-observation payment prices from archived operational batches. The public cache-only endpoint filters by the same exact-radius station selection as Home. The app retains its current station, membership, rating and E85 filters. No personal visit history or signed-in account is required. National is unchanged and never substituted for Local.

Sampling is the first eligible station observation per UTC day, drawn from complete sweeps. This is a daily observed-price series, not every intraday update or verified pump truth. Missing observations remain missing. The original raw objects and research window are unchanged. The initial backfill uses retained complete sweeps within 46 hours; it cannot recreate expired raw observations from national totals. New daily data accumulates into a seven-day chart. Derived daily rows expire within eight calendar days through a bounded hourly cleanup and operational manifest cascade.

Validation:
- 45 focused Trends/endpoint tests passed, including empty-cache first fetch, exact request parameters, Local default, preferences, restore and refresh failure behavior.
- 165 normal unit tests passed.
- SQL candidate was tested in a rolled-back transaction: fresh credit/cash, duplicate grades, future/stale reports, exact radius, complete sweep visibility, manifest mismatch, idempotency, bounded retention and private RPC access. A full-size five-grade batch passed the two-second local-projection gate.
- Scoped migration and `gas-prices` deployed. Unrelated pending migrations were not applied.
- Signed Release build succeeded, signature verified, installed in place on the connected iPhone 18 Pro Max; installed app reported 1.0.0 (38). Existing data preserved. Installation is not a first-install visual test.

Backfill completed: 216 immutable batches across three complete sweeps (October 27 18:00, October 28 00:00 and October 29 00:00 UTC), each verified against its SHA-256, size, station manifest and observation window before deriving local rows. See archive-backfill.json. No provider requests were made.

The public fresh-session verifier loads the actual app Trends service with empty memory/disk caches and the public app key, using live history and nearby-price endpoints. Tampa, Los Angeles and Des Moines all returned historical local series and station leaderboards. See first-launch-public-verification.json. This is service-layer verification, not a visual first-install test on the phone.

The scheduled 15:00 sweep completed 72/72 batches; all 192 retained operational slots are complete, the ten national cache scopes match the latest complete sweep, and projection backlog is zero. Both retention schedules are active. See service-health.json.

Capacity: the live data volume had 6.81 GB available on an 8.35 GB filesystem. Measured daily-index usage and seven/eight-day extrapolations are in history-capacity.json; allow 200–400 MB for seven days including indexes and headroom. The total database is roughly 1.23 GB. Physical capacity does not prove plan-quota compliance: the last saved dashboard evidence (October 19) was Free/Nano, while the current dashboard session requires sign-in. Current billing tier was not verified or changed. Supabase documents a 500 MB Free database allowance (https://supabase.com/docs/guides/platform/billing-on-supabase). Raw archives and credentials are not committed.
