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

At this checkpoint the changes have passed local tests; deployment and the live nationwide verification are pending. No billing or hosting migration is involved.
