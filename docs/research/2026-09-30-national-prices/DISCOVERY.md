# Resumable regional discovery and rate-limit evidence

Nationwide collection is not complete yet. The regional price queue is still paused until all 50 states plus DC reconcile. The discovery queue is server-side, region-pinned, leased, idempotent, and preserves partial inventories and every attempt. Initial bootstrap consists of 14 state groups and three remaining Texas brand groups; completed older Texas partitions are retained in the partial catalog artifact.

On September 30 at 19:35:48 UTC, a local inventory probe received HTTP 429. That older probe did not capture response headers. Its one-hour cooldown was an operator assumption, not a measured provider policy. A single small request from the same local environment with unchanged headers succeeded at 20:23:42 UTC (47.9 minutes later). It returned neither Retry-After nor quota/reset headers. See `rate-limit-recovery.json`. This proves recovery for that small query by that time; it does not establish the earliest recovery, quota, limiter key, or the capacity available to larger queries.

GasBuddy's public configured-rate-limiter package accepts externally supplied instance configurations. It does not disclose the production configuration for the GraphQL endpoint: https://github.com/gas-buddy/configured-rate-limiter/blob/master/src/index.js . No fixed production quota has been established.

The new national/discovery retry policy honors positive Retry-After values without imposing a one-hour minimum. If absent, consecutive 429s since the last successful collection use 60, 120, 240, 480, 960, 1920, then 3600 seconds. The database shares this pause among all three regional national workers. This is our conservative scheduling policy, not proof that the provider shares a limit across regions. No provider session cookies are persisted by these workers. The existing 24-city campaign has not been rerouted or rewritten.

Bootstrap schedule `fuel-national-discovery` runs every minute, allows only one active discovery request globally, caps discovery at 30 attempts per rolling hour, and is bounded to eight hours. It cannot run while national price collection is enabled. 401/403 and schema-level GraphQL errors stop discovery for inspection. Regional handlers reject a mismatching SB_REGION before accessing the queue or provider.

Admin tooling:

- `node scripts/national-prices/discovery.mjs seed`: idempotently queues the initial tasks; does not enable traffic.
- `node scripts/national-prices/discovery.mjs status`: returns queue and cooldown summaries.
- `node scripts/national-prices/discovery.mjs export <new-directory>`: preserves successful raw inventory responses as gzip files, without overwriting previous exports.
- `tests/nationalDiscovery.integration.sql`: transactional rollback verification of leases, shared cooldowns, permissions, regional ownership, and partial evidence. Requires an empty paused discovery queue.
- `tests/providerRetry.integration.sql`: transactional rollback verification of explicit and missing Retry-After behavior.

Verification: 45 focused Node tests passed. Transactional database tests covered regional leases and cooldowns. Real HTTP workers initially exposed Supabase safe-update enforcement missing from direct SQL tests; migration `20260930225000` adds explicit singleton predicates to all queue configuration updates. The first real East discovery batch then succeeded at 20:33 UTC. National price collection remains disabled pending complete inventory.
