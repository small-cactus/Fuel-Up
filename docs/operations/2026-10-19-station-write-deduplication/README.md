# Station publication write deduplication

The old publisher rewrote each station for every newer observation, even when its JSON and coordinates were identical. The price lookup already suppressed unchanged quotes; the main station row did not.

The candidate stores the last successful observation once per fixed catalog/batch. Station contents change only when their payload, coordinates, initial metadata availability, or catalog membership changes. App reads resolve effective observation time and job through `fuel_station_current`; provider report timestamps are never advanced by a successful check. Publication and its trend summary/receipt remain atomic. A serialized publication fence protects late retries and overlapping catalog transitions. Complete Trends publication locks both station content and receipts so an unchanged partial sweep cannot leak into a completed cache.

Existing rows can attach their batch membership in bounded batches using their actual content jobs, without changing prices or timestamps. This is one-time setup write overhead, excluded from steady-state measurements. Old content job references may become null when eight-day operational metadata expires; current batch receipts remain protected. Original research, evaluation boundaries, raw archive retention, and the latest published archive protections remain intact.

## Local validation

`node scripts/national-prices/testStationDedup.mjs` starts and removes a disposable PostgreSQL cluster, with no production/provider requests. An optional path to two audited saved observations per batch adds real-price replay parity checks.

Tests cover unchanged physical tuples, fresh check timestamps, unchanged provider report times, nearby/leaderboard output, partial/complete Trends, stale and same-observation retries, quote removal, persistent E85 availability, metadata changes, malformed coverage, catalog transitions, allowed retention, rollback after summary failure, membership preparation, and permissions. A separate bounded verification allowance test covers default budgets, explicit per-run authorization, expiry, normal-run isolation, cooldowns, archive capacity, and admin-only creation.

Six immutable archives from 17:00/18:00 UTC, one batch from each of the three regions per hour, passed read-back audit. The old path rewrote 6,000 stations; the candidate rewrote 181. Serving values and trend totals matched. Local WAL fell approximately 93.1%. Coordinates were minimal local fixture metadata where the price-only archive omitted them. Synthetic tests: 2,000 unchanged station rows became zero station writes plus one receipt; 10% changed became 200 station writes. WAL is write-ahead log volume, not total production disk IO. These are not production performance guarantees or verified pump prices.

39 targeted cloud-serving, projection, repair, archive, retention, routing, leaderboard and reported-price tests passed.

## Explicit live-test authorization

The user requested an additional live nationwide sweep, explicitly allowing repeated provider requests for this test. The extra sweep must use the existing three regional functions, shared pacing/cooldowns, archive capacity and immutable uploads. A separate admin-only allowance expires at the hour boundary, caps the verification run independently, includes its requests in aggregate hourly accounting, and does not increase the regular run's own limit. Installing the allowance migration alone starts no collection.

The two migrations deployed atomically at 18:34:58 UTC. Existing membership preparation attached all 141,660 stations without provider requests or price/timestamp changes. Public cached-serving checks passed in all three configured regions. The extra live sweep was queued at 18:39:16 UTC with a 19:00 UTC deadline; completion and live resource results remain pending. No billing or hosting migration is involved.


## Live verification result

The extra run collected all 72 batches on their fixed routes, with exactly 72 provider attempts and 141,660 inventory stations. It started at 18:39:16 UTC, completed at 18:54:34 UTC (15m18s including dispatch), and published all ten Trends scopes at 18:55:00 UTC, 26 seconds later. All 72 station projections and summaries completed; the station-row counter advanced by exactly 9,669, matching batch receipts. This is **93.17% fewer station updates** than rewriting every observed station. Successful provider observations spanned 14m29s. Immutable read-back verified all hashes, sizes, station IDs, coverage, and regional provenance. These are provider observations, not independently verified pump prices.

One serving projection timeout occurred and recovered; no provider attempt failed. Public cache checks passed during and after collection in all three requested regions, and national responses advanced to the verification run. All five operational cron schedules, including retention, remained active; latest-complete projection backlog was zero. The verification allowance expires automatically at 19:00 UTC and does not raise the next scheduled run's budget.

**Resource limitation:** measured I/O wait ranged roughly 6.9–34.9% during sampled collection intervals and swap traffic persisted, with no OOM kills in these intervals. This does not prove sustained stability or a 93% reduction in total disk I/O. Local WAL reduction, live station-update reduction, and total host disk I/O are distinct measurements. The one-time membership setup is excluded from the live station-update comparison. Historical gap counts remain preserved. No billing changes or Windows migration occurred.
