# E85 map availability and AFDC coverage — October 1, 2026

Selecting E85 now shows known E85 stations without requiring an up-to-date price. An unpriced station has `price: null`, no posting timestamp or fallback prices, an **E85** native pill, and **E85 available · Price unavailable** on its card. It remains selectable and navigable. Fresh priced stations rank first; unpriced stations follow by distance. Unpriced stations never become the green cheapest-price winner or enter Trends averages/leaderboards. The existing radius, membership and rating filters still apply.

Cache reads and the idle price-expiry timer downgrade expired E85 prices to availability records. Other fuel grades retain the raw reported-within-24-hours rule. The local cache version is incremented so older eligibility results are not reused. No price is inferred or borrowed from another station.

## Additional source

The [DOE AFDC All Stations API](https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/all/) returned 4,804 public, available US E85 listings. Three key-access sites are excluded; public sites accepting credit cards after hours or at all times are retained. 4,801 source records are stored in a private, separate database directory, including 186 in Florida. Matching found 3,954 corresponding existing stations; 396 lacked prior E85 listing evidence. 847 records remain standalone directory entries. These are not necessarily 847 unique new physical stations: ambiguous/changed addresses can remain unmatched.

Matching requires an unambiguous normalized address within 200m, or a unique matching brand with the same house number within 150m (or matching brand within 25m for coordinate-level agreement). Nearby stations alone never inherit each other's prices. Matched records use the existing station ID and its own prices; unmatched records use stable `afdc:` IDs with no prices. Raw GasBuddy observations and research archives are untouched.

The app reads only Supabase's cached directory and prices. No AFDC/provider request occurs on a user's map query. The directory is an October 1 snapshot, **not a new automatic daily collector**. It can be refreshed using the same protected import; absence from a later complete directory snapshot deactivates that AFDC record. Existing independent provider evidence remains independent. Neither directory is guaranteed complete/current or verified pump truth.

`afdc-source.json.gz` preserves the downloaded response, and `source.json` records its hash/filter. To reproduce import: decompress the snapshot, run `node scripts/e85-directory/prepareImport.mjs source.json import.sql`, inspect the generated transaction, and apply with the protected Supabase database CLI. The importer rejects incomplete/duplicate-ID snapshots, escapes source text, and replaces availability atomically. Obtain a developer API key for ongoing scheduled AFDC access; the documented demo key was sufficient for this single research fetch. Credentials are never stored here.

## Verification

- Migration applied and recorded; directory imported; `gas-prices` deployed. Directory table remains inaccessible to anonymous direct reads. No collector schedule, raw price, national inventory or archive changed.
- Live cache-only endpoint → client map model: Clearwater center 27.973, -82.764, 15 miles returns **13 E85-listed stations: 4 priced and 9 unpriced**, versus the previous 4 requiring a price. All 13 survive the client model. The same regular-gas request returns 207 fresh priced stations and zero unpriced entries. See `verify.mjs` / `endpoint.json`.
- `npm test`: 151 passing. Fuel-cloud: 56 passing. Trends: 35 passing. Import/preferences/trajectory: 11 passing. Regression coverage includes expired/null quotes, no fallback prices, radius/membership filtering, and import access/completeness checks.
- iOS simulator build passed. Actual unpriced pill tapped; it focuses its map location and selects its own correctly named/addressed card without a dollar value or rank. Light/dark screenshots saved; no $0.00 or Infinity is displayed. The app's existing UIKit glass pills and React card are reused.
- Current native Glass Lab live merge/split test passed: 1,648 frames and 94 transitions; no false parent bridges. Animation geometry/physics were unchanged.
- Required legacy `clusterProbe.integration.test.cjs` did not pass: it timed out waiting for a suitable watched cluster. The legacy artifact reported `waiting` / “Waiting for a multi-station cluster near the map center.” Its thresholds and detection logic were not weakened. This is a remaining legacy probe coverage limitation, separate from the successful current native test.

- Final iOS Release build succeeded and was installed on the paired iPhone 18 Pro Max. The phone app was not opened; interaction validation above was on the simulator.
