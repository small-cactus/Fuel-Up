# Raw Local / National Trends

October 1, 2026. The competitors section is removed. Trends has Apple's native
segmented picker for Local / National, with regular Liquid Glass for the list.

- National returns the five cheapest eligible stations for the selected fuel
  grade from the existing nationwide serving cache. It uses credit first, fresh
  cash fallback, and the existing duplicate-grade/E85 policies. No provider call
  or estimate is part of the request. Ties use station ID for stable ordering.
- Local fetches the same raw, radius-bounded snapshot as Home and applies the
  user's rating, brand and E85 preferences. Its leaderboard works without history.
- Both lists exclude missing, future-dated or older-than-24-hour reports and
  remove prices when they expire on screen. Fetch/observation time never extends
  provider report age. Cash-only prices are labelled.
- Legacy history's displayed values could already contain corrections. Local
  history now reads only the original `_payment` payload, with a valid provider
  timestamp and source; unverifiable rows are excluded. The report must have
  been fresh at observation time. Raw historical observations are not overwritten.
- Charts show arithmetic means of actual observation buckets, on a time axis.
  No predicted values, live-price projection into history, synthetic flat series,
  curve smoothing, or bridging missing buckets. Rank changes are unavailable when
  the historical comparison lacks candidates; no baseline price is invented.

## Deployment and performance

Applied and recorded migrations `20261001160000` / `20261001160500`; deployed
`gas-prices`. The price lookup table is maintained transactionally by the existing
latest-cache publication. Only changed prices update the projection; metadata-only
updates skip it. Raw JSON and immutable research archives remain intact.

The indexed projection contains 318,856 payment quotes and occupies 74 MB including
indexes. The initial full-JSON scan took 8.85 seconds; the indexed database query
took 1.21 seconds in the measured plan. End-to-end warm checks across five grades
took 351–731 ms. These are individual measurements, not latency guarantees.

## Verification

- `npm test`: 143 passing app tests.
- `npm run test:fuel-cloud`: 54 passing service tests and shared-source check.
- `npm run test:trends`: 27 passing tests, including raw legacy-price recovery,
  missing history, preferences, abandoned requests and native-page refresh state.
- `tests/nationalLeaderboard.sql`: live transaction-rolled-back fixtures cover
  stale/future timestamps, exact 24-hour cutoff, raw payment precedence, tie order,
  removal/update of index entries, duplicate grades, E85 and RPC privileges.
  No fixture stations remained after execution (`projection-health.json`).
- `node scripts/national-prices/verifyLeaderboard.mjs`: public endpoint station
  IDs, prices and report timestamps exactly matched the cache for all five grades.
  See `serving-verification.json` and the final deployment recheck in
  `serving-verification-final.json`. No collection/provider requests were made.
- iPhone 13 mini iOS 26.5 simulator: Local/National switching, light/dark themes,
  and large accessibility text inspected. Fixed local hero price overflow; rows
  stack and scroll at large type. Screenshots accompany this report.
- Scoped ESLint: zero errors; styling/performance warnings remain. No native
  clustering code changed, so the cluster animation probe was not rerun.

## Limits

Some cached national entries currently have only state and coordinates, without
name or street address. The screen shows `Gas station` plus the stored state; it
does not invent metadata or fetch the provider to fill it. Historical averages
are observation-weighted for currently eligible local stations and may be sparse.
These are provider reports, not verified pump prices. No phone installation is
part of this change.
