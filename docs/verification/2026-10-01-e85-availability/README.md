# E85 station availability — October 1, 2026

Require E85 now means that the provider has listed E85 at that station, independently of whether its E85 price is available or fresh. Prices displayed and ranked for the selected grade remain reported values from the last 24 hours. No shared regional price, estimate, or missing-price fill is introduced. Selecting E85 as the actual purchased grade still requires a fresh E85 quote.

## Implementation

- Persist `e85_listed_at` by station ID outside the raw station JSON. A later hourly response omitting E85 does not remove the listing.
- Backfill from existing E85 product entries (including empty quotes) and already collected, successful E85-specific discovery results with matching scopes. No new provider requests.
- Return `offersE85` through the radius RPC and normalized quotes. Home/preferences and local serving use that flag; the national leaderboard and future filtered trend summaries use the same database evidence.
- Preserve radius geometry, memberships, preferred-brand ranking, and raw-price/history storage. Unknown availability does not match. Provider listing evidence is not independently verified pump availability and can become outdated if pumps are removed.
- Bump the local response-cache version so old price-dependent eligibility is not reused.
- National results remain published only after an entire hourly sweep completes. The prior cache stays available during collection. Existing historical summaries are preserved. Deployment occurred during the 19:00 UTC sweep: its Require E85 trend cohort spans the old and new predicates. Subsequent full sweeps use the new availability predicate throughout; no historical recomputation is claimed.

## Verification

- `npm test`: 149 passing; fuel-cloud tests: 55 passing; Trends tests: 35 passing; focused client tests: 18 passing.
- Migration tested inside a rolled-back transaction. An unpriced E85 entry set availability; removing the entry preserved it; nearby RPC retained the flag; anonymous direct access to raw stations remained denied. `trigger-check.sql` reproduces this against the migrated schema and rolls back its synthetic station.
- Migration applied and recorded; `gas-prices` deployed to `vjindchxfebaltbslqwc`. Collection workers were unchanged.
- `database.json`: 6,945 E85-listed stations versus 3,110 with fresh E85 quotes at verification; 299 listings in Florida. 4,810 listed stations had a fresh regular quote.
- `verify.mjs` / `endpoint.json`: cache-only live checks at Clearwater (27.973, -82.764), radius 15 miles, regular gas. 204 total priced stations; Require E85 returned exactly the 7 listed candidates, including 3 with no fresh E85 price. Checked freshness, radius, flag, and absence of estimates. This is a reproducible test location, not a claim about the user's current position.
- `verify-national.mjs` / `national-endpoint.json`: after run 714 completed, normal scheduled publication produced availability version 1. The live Require E85 national top five matched the protected database query exactly by station ID, reported price, and timestamp.
- Release iOS build succeeded and installed on iPhone 18 Pro Max. App was not foregrounded; device interaction was not visually retested.

Run the endpoint check from the repository root with `node docs/verification/2026-10-01-e85-availability/verify.mjs`. Protected database checks are in `verify.sql` and `trigger-check.sql`; credentials are never embedded in artifacts.
