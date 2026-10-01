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
- Live archive bootstrap, endpoint checks, and simulator verification are in progress at this checkpoint.

## Limits and incident evidence

The first nationwide archives contain IDs and prices, but no station names or detailed addresses. Existing local metadata seeds 952 names; other stations use honest generic labels until their first metadata-enabled scheduled sweep. Coordinates and navigation still use actual catalog locations. Rating/brand filters cannot use metadata that has not yet been collected.

At 14:15 UTC, before these changes were deployed, the collector paused on a new HTTP-200 GraphQL error. Its saved first ten messages report internal `read ECONNRESET` failures; only the first ten messages were retained, so they do not establish the classification of the entire error list. The recorded shared cooldown ends at 15:15:38 UTC. `health-before.json` and `provider-error.json` preserve that evidence. This integration does not override that pause or relabel older successful observations as newly collected.

The serving cache preserves available observations after the existing seven-day collection window. This task does not extend that window or claim verified pump truth. Texas/DC coverage assumptions from the published catalog still apply.
