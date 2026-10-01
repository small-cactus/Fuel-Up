# Trends loading and ranking verification — October 1, 2026

National now uses one protected database read, computes complete-sweep eligibility once per run, and returns only the fields used by the chart and top-five list. The app retains successful results for five minutes per fuel/filter/reset scope; pull to refresh bypasses this cache. Expired prices remain hidden. No estimates or provider requests were introduced.

Local previously boosted preferred brands while Home sorted by price, and refreshed on an hourly cadence using an independently loaded snapshot. Both now use the same station filtering and stable price/ID ordering, reuse a recent station snapshot, and refresh at five-minute intervals or on focus/foreground. Home also publishes its fallback GPS origin so Trends uses the same radius center.

## Measured endpoint results

| Measure | Before (6 requests) | After (12 requests) |
| --- | ---: | ---: |
| Median response bytes | 6,072.5 | 2,287.5 |
| Median elapsed time | 688.5 ms | 440.5 ms |
| Range | 479–1,315 ms | 251–1,426 ms |

Payload is 62.3% smaller; sample median latency is 36.0% lower. These sequential local-to-Virginia endpoint samples include network and cold-start variability, so they are not a universal latency guarantee. The first post-deployment request was still 1,426 ms. Compared station IDs and all eleven history points remained unchanged in these samples. Raw measurements are included alongside this report. Reproduce the after measurement with `node scripts/national-prices/benchmarkTrends.mjs`; it reads only the cached public endpoint and prints no credentials.

## Verification

- Before applying the migration, a rollback transaction captured old raw leaderboard/history outputs for all five grades with both E85 filters. It applied the new SQL inside the transaction and asserted exact equality against the combined read. Existing `tests/sql/nationalTrendHistory.sql` completeness, price freshness, and archive-hash gates also passed in the transaction.
- Applied `20261001175000_lightweight_national_trends.sql` and deployed `gas-prices` to the existing Supabase project. `verifyTrendHistory.mjs` then verified all ten grade/filter combinations against protected history and independently recalculated the September 30 baseline from all 72 archived batches. See `history-verification.json`.
- `npm test`: 143 passed before the additional GPS-origin regression; that new regression plus both existing Home lifecycle tests also passed (3/3).
- `npm run test:fuel-cloud`: 54 passed. `npm run test:trends`: 30 passed. New checks cover exact Home/Local ordering, fresh-snapshot reuse, National cache revisit, scope isolation, abort/reset, TTL, offline retention, and raw-response shaping.
- ESLint: no errors; one existing memo-dependency warning remains for the explicit freshness tick that removes expired Local prices. `git diff --check` and the benchmark script syntax check passed.
- Release iOS build succeeded. Installed `com.anthonyh.fuelup` on the user's iPhone 18 Pro Max via device installation service. The phone app was not opened; visible checks below are simulator evidence only.
- FuelUp Glass Lab simulator: Home and Local both showed Costco, $3.92, 8712 W Linebaugh Ave, 9.9 miles. National rendered its average/history and top five. Returning Local → National within five minutes restored the chart/list without a National request; the network inspector captured only Local's `station_prices` history read. Screenshots included.
- No chart component, chart interpolation, map animation, or native cluster transition implementation changed. The existing native cluster probe was not run for this data-loading/ranking change.

Database provenance remains in protected tables and immutable archives; trimming the app response does not delete that evidence. Unchanged gaps in the chart reflect missing completed collection hours, not fabricated interpolation.
