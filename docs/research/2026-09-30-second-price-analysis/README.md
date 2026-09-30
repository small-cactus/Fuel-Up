# First hourly nationwide comparison

Compared the September 30 **22:00 and 23:00 UTC** nationwide sweeps (6 PM and 7 PM Eastern), runs **22 → 82**. Both contain the same **141,660 station IDs**. Individual stations were observed 59.93–61.14 minutes apart; median interval 60.32 minutes. City history is frozen at **23:20:41 UTC**, with 122 checks, 2,440 station observations, and 497 distinct stations in 24 cities.

These are changes in provider reports, not verified changes at pumps or established corrections of earlier errors. No prediction model or production ranking was changed.

## Nationwide changes

| Metric | Result |
| --- | --- |
| Positive quotes available in both sweeps | **316,123** |
| Changed prices, matching station/fuel/payment | **5,353 (1.69%)**, across **2,739 stations** |
| Downward / upward changes | **4,491 / 862**: **83.9% downward** |
| Unchanged price, newer timestamp | **30,661**, at 10,374 stations |
| Share of timestamp advances without price change | **85.1%** (30,661 / 36,014) |
| Unchanged price and timestamp | **280,109** |
| Newly available / newly missing positive quotes | **2,301 / 2,031** |
| Positive quotes, before → after | **318,154 → 318,424** |
| Stations gaining any price after having none | **716** |
| Stations losing all previously available prices | **629** |
| Stations with any positive quote, before → after | **93,169 → 93,256** |

Each grade/payment combination counts separately. A station-wide report can update several grades and both cash/credit at once; these are not 5,353 independent reporting events. Missing means a positive quote became absent/null/zero, not that the station closed. All 5,353 price changes had a newer report timestamp; no comparable quote's timestamp moved backward.

## Size of the changes

Among the 5,353 changed quotes, the median absolute change was **6¢/gallon**, the 95th percentile **24¢**, and the maximum **$1.46**. Restricting to regular credit gives **1,833 changes**, median **6¢**, 95th percentile **22¢**, maximum **77¢**. These are change magnitudes, not prediction-error statistics.

| Example | Before → after | Change | Earlier report age at first observation |
| --- | --- | --- | --- |
| Ohio, station 211307, E15 credit | $3.53 → $4.99 | **+$1.46** | 5.10 hours |
| Oregon, station 36639, premium credit | $5.79 → $6.89 | **+$1.10** | 58.18 hours |
| California, station 26564, regular credit | $5.75 → $6.50 | **+75¢** | **3.39 hours** |
| Florida, station 107099, regular credit | $4.89 → $4.12 | **−77¢** | 48.24 hours |

The California change represents **$11.25 on 15 gallons**, despite the prior report being only a few hours old. That limits what an age-only filter could detect, but does not establish that the earlier price was wrong when posted. The E15 observation is a different grade and should not be compared directly to regular gasoline.

## A possible two-day reporting boundary

**1,412 of 2,031 newly missing quotes (69.5%)** were **47–48 hours old** in the first sweep. Of the 3,770 positive quotes in that age band, **1,412 disappeared (37.5%)** and **847 changed price (22.5%)** by the next sweep. The youngest newly missing quote had been 46.995 hours old; the actual collection interval varied slightly around one hour.

This is consistent with a provider expiry/refresh boundary near 48 hours. It is an inference from two sweeps, not a confirmed API retention rule. Prices remain available beyond 48 hours for many records, so a universal hard cutoff would overstate the evidence. In particular, a lost quote must not be treated as a zero price or a verified closure.

## Cheapest-choice failures in the repeated city sample

The same-candidate comparison now includes **400 city/fuel/payment transitions**, versus 361 previously. There are **four price-only cheapest-choice reversals (1.0%)**, versus three previously. Every initial winner in these four cases was unique, so tie-breaking does not cause the result. The maximum later reported price gap remains **10¢/gallon**; the 95th percentile across all 400 comparisons is still zero.

The new case matches the recommendation risk under investigation:

- **Las Vegas Costco premium credit** was cheapest at **$5.79**, then updated to **$5.89** between 21:41 and 22:41 UTC.
- **ARCO was then cheaper at $5.81** among the six common priced candidates.
- Choosing the previous winner would cost **8¢/gallon more**, or **$1.20 on 15 gallons**, relative to the later reported alternative.
- Costco's earlier premium report was only **37 minutes old** at the first check.

Unlike the earlier three reversals, this one involves the former winner's own upward update. It does not prove a customer actually paid the higher amount or that the original quote was false. Membership eligibility, driving distance, and user preferences are not included in this price-only audit. Common candidates exclude stations absent from either observation, so this is not a full-city opportunity or national recommendation-error estimate.

City history now contains **32 actual quote changes across 21 stations**, up from 24 across 17 at the previous cutoff. There were 367 unchanged-price timestamp advances and 32 changed-price advances (92.0% unchanged). The national matched-hour sample is much larger and gives 85.1%; the two percentages cover different selected populations/time intervals and should not be described as a trend.

## Collector health and verification

- Run 82 finished at **23:15:03 UTC**: **72/72 batches**, **141,660/141,660 stations**, **zero missed batches**, **zero wrong-region jobs**.
- There were **73 attempts**: one HTTP 503 included `Retry-After: 5`, and the existing retry mechanism recovered. Failure evidence is preserved in [health.json](health.json). The old error string/cooldown timestamp remains in the configuration as historical state; it is expired, and the completed run demonstrates recovery. No manual schedule or cooldown changes were made.
- City campaign has **zero missed slots**, no recent city errors, and both collectors' dispatcher/watchdog schedules remain active.
- Total national archive use is **7,336,918 bytes**, below 1% of the 900 MB cap. Collection remains bounded by the original October 7 deadline.
- All **144 archive objects** across the two hours passed the shared `auditArchive.mjs` validation: hashes, bytes, exact ordered IDs, quote schema, provenance, observation windows, duplicate absence, and priced counts. An independent JavaScript comparison reproduced the Python comparison's changed quotes, distinct changed stations, timestamp-only refreshes, gained quotes, and lost quotes exactly. See [archive-audit.json](archive-audit.json).
- The city counts were independently checked against protected database queries at the same export cutoff. No extra provider requests were made for analysis. Final-two-day holdout data was not read, and the scripts reject that period.

## Reproduction and saved evidence

- [comparison.json.gz](comparison.json.gz): complete national comparison, all 5,353 changes, age cohorts, per-state/grade counts, and original archive paths/hashes. Compressed losslessly to keep repository size down.
- [snapshot-analysis.json](snapshot-analysis.json): second-sweep distributions and full early-city analysis, including individual price changes and ranking reversals.
- [cities.json.gz](cities.json.gz): fixed city export used by the analysis. Its hash is recorded in the snapshot analysis.
- `scripts/national-prices/comparePriceHours.py BEFORE_DIR AFTER_DIR OUTPUT_JSON` validates and compares the two hours. Each input directory needs its protected run/job manifest (`manifest.json`) and private Storage archives at their original object paths. The second directory also needs the saved city export (`cities.json.gz`) for the campaign holdout boundary.
- `scripts/national-prices/analyzeEarlyPrices.py AFTER_DIR OUTPUT_JSON` reproduces the snapshot/city metrics. Outputs must not already exist. National catalog and baseline results remain in the previous dated research directories.

The next analytical priority is learning which low-price winners later move above their local alternatives. One hourly national transition is enough to identify cases and reporting patterns, but not enough to establish time-of-day effects, reporting fraud, or reliable tail-risk prediction.
