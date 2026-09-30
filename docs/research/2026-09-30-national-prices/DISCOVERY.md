# Resumable regional discovery and rate-limit evidence

Nationwide collection is not complete yet. The regional price queue is still paused until all 50 states plus DC reconcile. The discovery queue is server-side, region-pinned, leased, idempotent, and preserves partial inventories and every attempt. Initial bootstrap consists of 14 state groups and three remaining Texas brand groups; completed older Texas partitions are retained in the partial catalog artifact.

On September 30 at 19:35:48 UTC, a local inventory probe received HTTP 429. That older probe did not capture response headers. Its one-hour cooldown was an operator assumption, not a measured provider policy. A single small request from the same local environment with unchanged headers succeeded at 20:23:42 UTC (47.9 minutes later). It returned neither Retry-After nor quota/reset headers. See `rate-limit-recovery.json`. This proves recovery for that small query by that time; it does not establish the earliest recovery, quota, limiter key, or the capacity available to larger queries.

GasBuddy's public configured-rate-limiter package accepts externally supplied instance configurations. It does not disclose the production configuration for the GraphQL endpoint: https://github.com/gas-buddy/configured-rate-limiter/blob/master/src/index.js . No fixed production quota has been established.

The new national/discovery retry policy honors positive Retry-After values without imposing a one-hour minimum. If absent, consecutive 429s since the last successful collection use 60, 120, 240, 480, 960, 1920, then 3600 seconds. The database shares this pause among all three regional national workers. This is our conservative scheduling policy, not proof that the provider shares a limit across regions. No provider session cookies are persisted by these workers. The existing 24-city campaign has not been rerouted or rewritten.

Bootstrap schedule `fuel-national-discovery` runs every minute, allows only one active discovery request globally, caps discovery at 60 attempts per rolling hour, and is bounded to eight hours. It cannot run while national price collection is enabled. 401/403 and schema-level GraphQL errors stop discovery for inspection. Regional handlers reject a mismatching SB_REGION before accessing the queue or provider.

Admin tooling:

- `node scripts/national-prices/discovery.mjs seed`: idempotently queues the initial tasks; does not enable traffic.
- `node scripts/national-prices/discovery.mjs status`: returns queue and cooldown summaries.
- `node scripts/national-prices/discovery.mjs export <new-directory>`: preserves successful raw inventory responses as gzip files, without overwriting previous exports.
- `tests/nationalDiscovery.integration.sql`: transactional rollback verification of leases, shared cooldowns, permissions, regional ownership, and partial evidence. Requires an empty paused discovery queue.
- `tests/providerRetry.integration.sql`: transactional rollback verification of explicit and missing Retry-After behavior.

Verification: 58 focused Node tests passed. Transactional database tests covered regional leases and cooldowns. Real HTTP workers initially exposed Supabase safe-update enforcement missing from direct SQL tests; migration `20260930225000` adds explicit singleton predicates to all queue configuration updates. The first real East discovery batch then succeeded at 20:33 UTC. National price collection remains disabled pending complete inventory.

Subsequent controls:

- `reconcile-scopes` queues a canonical state-name query, then the state abbreviation if needed, for results that failed scope checks. It never substitutes a local-area count for a statewide count.
- `catalog [new-file]` reconciles complete state inventories and Texas partition unions. Missing states, wrong geographic scopes, stale observations, and count mismatches remain explicit gaps.
- `configureDiscovery.sql` starts the bounded discovery schedule and preserves any provider cooldown. Repeating it does not extend the existing bootstrap deadline.
- National price workers use a database-enforced 15-second minimum request interval and a 45-second work window, allowing approximately three batches per minute while leaving room before the next cron tick. This is operator pacing, not a measured provider limit. National prices remain paused until the catalog is complete.
- Both discovery and price transports retain allow-listed response metadata for diagnosing quota/reset information, excluding cookies and credentials.


### Geographic and fuel reconciliation

Canonical names fixed the qualified-search geocoder errors in several states. Texas still exceeds the 10,000-result window, so its complete catalog requires the union of state, brand, fuel, and address-filtered nearby inventories to equal the actual statewide count. A fuel subset's count never replaces that denominator. Geographic query batches are bounded to 32 centers and an 8 MB decoded response; they retain every center and measured response duration/size. They use the same East worker, request cadence, shared cooldown, and lease as other discovery work.

The offline geographic planner uses the included January 2026 Census DC/Texas boundary artifact. Its Texas circles conservatively cover the polygon assuming the empirically observed approximately 25 km nearby footprint. Stop remaining geographic tasks when the statewide union reconciles. The planner needs Python, Shapely 2.1.2, and NumPy; it never contacts the fuel provider.

DC has no verified DC-only geocoder result. Its explicit geographic certificate requires two distinct full nearby responses, centers at least 1 km apart, every Census boundary vertex within 23 km, evidence that the returned footprint extends at least 24 km, and identical DC-addressed station IDs. This is conditional geographic coverage, not a provider-reported DC total or verified pump truth. The certificate records the assumption and source rather than inventing a state count.

The collection-window migration separates inventory observation time from the bounded period for refreshing prices for that fixed inventory. An explicit catalog validity window is capped at eight days after publication. It never rewrites inventory timestamps to imply a new enumeration. The national watchdog restores only a missing main schedule while collection is enabled and within its deadline; it does not undo manual pauses or access denials.


Deployment operations:

- After full reconciliation, publish the catalog using `publishCatalog.mjs`. Publishing leaves price collection paused.
- `activate.mjs <end-ISO>` starts a bounded window of at most seven days, preserves provider cooldowns, disables bootstrap discovery, installs the minute dispatcher and five-minute watchdog, and allows 20,000 station lookups of retry headroom per hour. The configured budget is our cap, not a provider-issued quota. If the current hour has insufficient time at the measured scheduling pace, it starts at the next hour instead of creating an intentionally incomplete run.
- `auditHour.mjs <run-id> [new-report.json]` downloads the immutable Storage objects through the authenticated Supabase CLI and independently checks hashes, exact station IDs, observation windows, missing-price counts, and execution regions. It makes no provider requests and does not print credentials. Temporary downloads are removed after verification.
- Initial archive capacity is capped at 900 MB. Extrapolating the existing Florida snapshot gives roughly 4.1 MB per nationwide hour / 687 MB per seven days; this is a planning estimate, to be replaced by the first actual nationwide hour. Reaching the cap pauses acquisition without deleting evidence.
