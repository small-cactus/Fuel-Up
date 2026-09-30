# First nationwide snapshot and early city history

Analysis frozen at **September 30, 2026, 22:34:19 UTC (6:34 PM Eastern)**. National data is the completed 22:00 UTC sweep, with batches collected over about 14.5 minutes. City data covers 112 successful city checks since 18:19 UTC: 2,240 station observations, 497 distinct station IDs, and 24 cities. These are provider reports, not independently verified pump prices.

## Findings

| Finding | Result | Interpretation |
| --- | --- | --- |
| Newer report, same price | **332 of 356 timestamp advances (93.3%)** | A report refresh usually did not change the price. This does not distinguish honest reconfirmation from inaccurate reporting. |
| Actual price changes | **24 across 17 stations** among 4,059 comparable quote pairs (0.59%) | Each fuel/payment combination counts separately; observations are correlated and the city sample is selected. Eight changes were upward; 16 downward. |
| Largest observed increase | Chicago BP premium credit: **$6.09 → $6.89 (+80¢)** between 21:21 and 22:21 UTC | Equivalent to $12 on 15 gallons. The earlier report was only 5.9 hours old at the first check. This is an observed update, not proof the earlier report was false. |
| Coordinated grade change | San Antonio QuikTrip: **+32¢ on all three gasoline grades** | Regular $3.67 → $3.99; midgrade $3.97 → $4.29; premium $4.27 → $4.59 between 19:25 and 20:25 UTC. Same-station grade changes should not be treated as independent evidence. |
| Regular-price age | Median **9.0 hours**, 95th percentile **44.8 hours** | 23,553 of 91,100 priced regular stations (25.9%) had report ages over 24 hours. Credit preferred, cash only when credit absent; each quote's age uses its own collection time. |
| Nationwide missingness | **48,491 of 141,660 stations (34.2%)** had no positive price on any returned grade/payment | Missing reports are a substantial part of coverage. A missing quote does not establish closure or lack of fuel. |
| Archived price detail | **318,154 positive grade/payment quotes** at 93,169 stations | Includes cash and credit separately, even when the same price. Includes 3,612 stations with E85 and 2,384 with E15 quotes. |
| Cash discount | **5,934 of 8,427 eligible pairs (70.4%)** had cheaper cash | Among those cheaper-cash pairs, median discount 10¢ and 95th percentile 20¢: $1.50 and $3 on 15 gallons. Not representative of all stations: both quotes must be available and contemporaneous. |
| Premium surcharge | Median **80¢**, 95th percentile **$1.30/gallon** | Across 34,571 eligible regular/premium credit pairs. Equivalent to $12/$19.50 on 15 gallons; fuel-grade choice must follow vehicle requirements. |
| Reported state medians | Indiana **$3.79**, Florida **$4.19**, California **$6.39** | Same-grade, credit-only reports no more than 24 hours old. Sample sizes 2,210 / 3,963 / 5,308; station-weighted descriptive medians, not sales-weighted or official state averages. California–Indiana difference is $2.60/gallon, or $39 on 15 gallons. |

Cash and grade comparisons require both reports to be 0–24 hours old, with timestamps within one hour of one another. This reduces time mismatch but cannot establish accuracy. All percentiles use nearest rank; no high-price cutoff or outlier removal was applied. The national recent regular-credit sample spans $3.15–$9.99; unusual extremes are not automatically classified as false.

## What happened to the cheapest choice?

We compared adjacent city observations using **the same station candidates, fuel grade, and payment type**. Each comparison requires at least five priced stations present at both times. There were **361 comparisons**; **three (0.83%)** had an earlier cheapest station that was no longer cheapest in the next observation. All three had a unique initial winner, so the result does not depend on a tie-breaking choice.

| City / fuel / payment | Previously cheapest, later price | New cheapest | Later price gap |
| --- | --- | --- | --- |
| Tampa / regular / credit | Marathon, $4.15 → $4.15 | Sunoco, $4.05 | **10¢** |
| Tampa / premium / credit | 7-Eleven, $4.93 → $4.93 | Sunoco, $4.85 | **8¢** |
| San Antonio / diesel / credit | Valero, $5.85 → $5.85 | QuikTrip, $5.79 | **6¢** |

All three reversals came from a competitor's lower updated price, not an upward correction at the previous winner. For example, the Tampa Sunoco's regular report dropped $4.17 → $4.05. The first regular recommendation then cost $1.50 more on 15 gallons relative to the new cheapest reported price.

The observed 95th-percentile ranking gap is **zero**, while the maximum is **10¢/gallon**. This illustrates why a percentile alone can hide rare events in a short, mostly unchanged dataset. It is too early to estimate reliable worst-case recommendation risk or correction-model accuracy. These comparisons are price-only among sampled stations, not reconstructions of the app's full distance/preference ranking, and later provider reports are not verified truth. Multiple grades from the same station/city are correlated.

## Additional descriptive observations

- Among the latest 18 priced regular-credit stations sampled in Los Angeles, the 10th–90th percentile spread was **$1.30/gallon** ($19.50 on 15 gallons). Those reports have mixed ages and the sample is not an entire city census or a guarantee of equally convenient alternatives.
- Twelve of the 34,571 contemporaneous regular/premium credit pairs reported premium below regular. Thirty-nine of 8,427 regular cash/credit pairs reported cash above credit. These are inspection candidates, not established errors.
- Every one of the 24 observed city price changes had a newer timestamp; none of the comparable report timestamps moved backward.

## Evidence, verification, and reproduction

- [results.json](results.json) contains full computed distributions, per-state summaries, individual change/ranking cases, input hash, and hashes/paths of all 72 national archives.
- [cities.json.gz](cities.json.gz) freezes the early city export used here; source hash is in the results. It contains public station observations and no user locations or credentials.
- National source: private Supabase Storage bucket `fuel-national`, run `22`, with immutable object paths listed in the results. The catalog is `../2026-09-30-national-prices/verified-catalog.json.gz`.
- Offline computation: `scripts/national-prices/analyzeEarlyPrices.py INPUT_DIR OUTPUT_JSON`. Input directory contains `cities.json.gz`, the run/job `manifest.json` used by `auditHour.mjs`, and downloaded archives at their manifest `object_path` locations. Output must not already exist.
- All 72 archives were downloaded again; SHA-256, byte sizes, expected IDs, unique station coverage, execution-region metadata, and aggregate priced counts were checked before analysis. Independent protected SQL over the same city export cutoff reproduced **4,059 comparable pairs, 24 changes, 17 changed stations, and 332 same-price timestamp advances** exactly.
- Re-running the offline analysis yielded identical results. No additional provider collection, production ranking changes, or model fitting was performed. The script rejects data from the reserved final two days of the research campaign.

Next useful evidence is repeated nationwide observations. Time-of-day patterns, inaccurate reconfirmation detection, persistent suspicious bargains, and dependable tail-risk modeling remain unestablished with this early sample.
