# Shared Local / National trend chart

Restored the prior edge-to-edge curved line and fading area fill; removed all
point markers. Both scopes render the same chart, headline, percentage and axis
layout. National uses the selected fuel grade's nationwide reported average,
not an average of the five cheapest stations. The fresh top-five list stays below.
Local radius/preferences and raw price eligibility are unchanged.

National history uses compact per-batch sums and counts from verified archived
provider observations. The existing fenced publication transaction records new
totals without additional provider requests. Only complete sweeps with all
manifest hashes represented become chart points. The mean weights each eligible
station equally; batch sizes are never weighted equally. Reports must have been
positive and no more than 24 hours old at observation time. Credit/cash selection,
E85 filtering and duplicate-grade policy match serving. Missing hours remain
missing; the restored curve is presentation only and generates no price records.
Changing reporting coverage can change the national average; these are reported
prices from the fixed inventory, not verified pump prices or a sales-weighted
national benchmark.

Validation: 143 app tests, 54 cloud tests and 28 Trends tests passed. The latter
include rendering both scopes through the same chart with different data,
no point markers, gradient fill, and cancellation of stale grade responses.
Rollback database fixtures verify payment precedence, freshness/future exclusion,
E85, duplicate grades, weighted totals, replay idempotence, incomplete coverage,
and mismatched manifest rejection. Lint has no errors (existing style warnings).
Light and dark simulator screenshots are included. Release build and installation
on the iPhone 18 Pro Max succeeded; the phone app was not opened.

Both migrations are applied and recorded, and the cache-only gas-prices endpoint
is deployed. Historical import from immutable Storage is in progress at this
checkpoint; `publishTrendHistory.mjs` is resumable and verifies every archive's
hash, exact IDs, schema and region before deriving totals. Original archives,
collection limits, routing, provider identity and production ranking are intact.
