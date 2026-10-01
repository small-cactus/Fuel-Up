# Nationwide cache serving integration

Home now reads the nationwide cache through `gas-prices`. The serving endpoint has no live-provider fallback, including `forceRefresh`, empty coverage, database errors, and requests for an unavailable grade. Scheduled regional collectors retain their existing ownership, identity, pacing, cooldowns, budgets, and October 7 deadline.

## Data flow

- Discovery supplies coordinates for all 141,660 published catalog IDs. The separate `fuel_station_latest` projection retains each station's latest successfully archived prices, both payment types, original posted timestamps, observation time, and source job.
- `finish_fuel_national_serving_job` commits the immutable archive manifest and serving projection in one transaction behind the original lease fence. Old/equal observations cannot replace newer data, and a newly empty price list clears that station's previous quotes.
- Missing station metadata is requested once within an already scheduled price batch. Later sweeps retain the metadata and fetch prices only, avoiding hourly repetition of names/addresses/ratings. The raw archives remain immutable.
- `publishLatestCache.mjs` bootstraps or repairs the projection using only archived objects, verifying hashes, byte lengths, ordered IDs, observation windows, and regional provenance before publication. No provider requests or synthetic historical observations.
- `nearby_fuel_station_cache` uses a latitude index range and exact great-circle distance. All stations within the radius are considered, including across state/collector boundaries and the date line. JSON aggregation avoids the default API row limit. Only the server role can execute the query.
- Database region verified live: `us-east-2`. Serving runs beside that shared database. The three collection regions are not read replicas; routing app reads through western workers would still require a round trip to the eastern database.

## App behavior

The existing credit-first/cash-fallback normalization, per-grade validation, E85 filtering, rating filter, and native map renderer remain in use. Raw cache data is not overwritten by prediction output. Provider posting time and archive observation time remain distinct from the time the app reads the DB.

Home presents an on-device snapshot immediately, then reads the database on focus, foreground, and every five minutes while active. Old pre-integration local caches have a different namespace. Exact cache keys preserve radius and origin; spatial reuse requires the entire requested circle to fit inside the cached circle. Narrower searches re-filter results and re-select the cheapest in-range station. Successful empty results clear old prices; network errors retain the available snapshot.

## Verification

- 138 app unit tests and 50 existing cloud tests passed.
- Focused cache/worker/Home lifecycle tests cover cache-only reads, payment/observation timestamps, radius/grade/E85 boundaries, full-circle coverage after movement, narrower-radius cheapest selection, focus refresh, cancellation, and archival publication.
- `nationalServing.integration.sql` passed in a rolled-back transaction against the real migrated DB: projection idempotency, wrong-ID rejection, older observation protection, exact radius, >1,000 stations without truncation, and RPC access control.
- Read back and hash/ID/provenance-verified all 72 latest successful archive batches. All 141,660 catalog stations have a serving observation; see `bootstrap.jsonl` and `cache-coverage.json`.
- All 24 live radius checks passed (six cities at 2, 5, 10, and 15 miles). Sets expand monotonically, every returned station is inside its radius, and force-refresh requests still return `national-cache`. Median request latency was 568 ms, maximum 1,745 ms. See `live-radius-checks.json`.
- All five fuel-grade checks passed. Correct-region worker health returned 200 and wrong-region probes returned 409 for each of the three workers. App endpoint probes did not change the collector's last provider-request timestamp.
- Simulator testing exposed a native camera-fit bottleneck with hundreds of stations: main-thread samples were entirely inside the old exhaustive contact-interval solver. Searches above 64 stations now use a bounded deterministic search of real capsule bounds. Smaller searches retain the exact solver; merge/split animation code is unchanged.
- Native camera tests pass with 65, 400, 1,000, and 2,000 stations across small/large phone viewports, preserving capsule bounds and input-order independence. The dense fixture set has a five-second total debug-test budget. Simulator interaction confirms 25 cards at 3 miles and 319 at 15 miles, visible by the 1.4/1.6-second post-tap screenshots. This is a UI observation bound, not an isolated request benchmark. See `simulator-radius.json`.
- The current Swift renderer passed its live transition test (1,615 frames / 113 transitions) and first-frame camera-fit gate (84 frames with every pill/count inside the inset). The original retired-map probe is being checked separately; no thresholds or timeouts were relaxed.

## Limits and incident evidence

The first nationwide archives contain IDs and prices, but no station names or detailed addresses. Existing local metadata seeds 952 names; other stations use honest generic labels until their first metadata-enabled scheduled sweep. Coordinates and navigation still use actual catalog locations. Rating/brand filters cannot use metadata that has not yet been collected.

At 14:15 UTC, before these changes were deployed, the collector paused on a new HTTP-200 GraphQL error. Its saved first ten messages report internal `read ECONNRESET` failures; only the first ten messages were retained, so they do not establish the classification of the entire error list. The recorded shared cooldown ends at 15:15:38 UTC. `health-before.json` and `provider-error.json` preserve that evidence. This integration does not override that pause or relabel older successful observations as newly collected.

The serving cache preserves available observations after the existing seven-day collection window. This task does not extend that window or claim verified pump truth. Texas/DC coverage assumptions from the published catalog still apply.
