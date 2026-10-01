# Price observations after recovery

This report compares the **October 1 00:00 and 01:00 UTC** national sweeps
(September 30, 8 PM and 9 PM Eastern), runs **142 → 177**, with cumulative context
from the September 30 22:00 UTC baseline, run 22. Every sweep covers the same
141,660 catalog IDs. The city export is frozen at **01:22:26 UTC**.

These are changes in provider observations, not verified pump prices, evidence of
reporting fraud, or measured prediction errors. No production ranking or model
settings were changed. The final two campaign days were not read.

## Nationwide price changes

| Metric | Previous sweep → latest | Baseline → latest |
| --- | ---: | ---: |
| Matching positive station/grade/payment quotes | 317,802 | 313,703 |
| Changed quotes | **1,852 (0.583%)** | **11,008 (3.509%)** |
| Distinct stations with changed quotes | **858** | **5,321** |
| Downward / upward changes | 1,469 / 383 | 9,115 / 1,893 |
| Downward share of changed quotes | **79.3%** | **82.8%** |
| Same price, newer timestamp | **22,739** | **54,903** |
| Same price and timestamp | 293,211 | 247,792 |
| Newly available / newly missing positive quotes | 919 / 933 | 5,018 / 4,451 |
| Median absolute change among changed quotes | 5¢ | 6¢ |
| 95th percentile absolute change among changed quotes | **28¢** | **30¢** |
| Largest absolute change | $1.59 | $1.59 |

For the latest comparison, **92.47% of timestamp advances repeated the price**
(22,739 / 24,591). All 1,852 price changes had newer report timestamps; no matched
positive quote's timestamp moved backward. These quote counts include separate
grades and cash/credit, so they are not counts of independent reporting events.
Baseline-to-latest numbers are endpoint differences: they do not count every
intermediate update or changes that later reversed.

There are **318,721 positive quotes at 93,193 stations** in the latest sweep;
48,467 catalog IDs have no positive quote in any returned grade/payment type.
Since the previous sweep, 231 stations gained any price after having none, while
315 lost all previously positive quotes, a net reduction of 84 priced stations.

## Large moves and freshness

| Location and station ID | Grade/payment | Reported change | Prior report age |
| --- | --- | --- | --- |
| Georgia, 42278 | Regular credit | **$3.95 → $5.29 (+$1.34)** | **59.17 hours** |
| Illinois, 48141 | Midgrade credit | $4.94 → $3.35 (−$1.59) | 4.59 minutes |
| Illinois, 63325 | Midgrade credit | $3.93 → $5.09 (+$1.16) | 5.91 minutes |
| Nevada, 8704 | Diesel credit | $5.49 → $6.49 (+$1.00) | 44.24 hours |
| Ohio, 123478 | Regular credit | $4.64 → $3.99 (−65¢) | 51.04 hours |

The Georgia regular-price change corresponds to **$20.10 on 15 gallons** when
comparing those two reports. This is not a measured recommendation loss against a
nearby alternative or proof of what a customer paid. It is a concrete stale-low
candidate for later modeling. The Illinois observations show that an apparently
fresh timestamp does not guarantee stability either; grade/reporting errors and
real changes cannot be distinguished from these snapshots alone.

Restricting the latest interval to **regular credit** gives **556 changed quotes**,
5¢ median absolute change, **20¢ p95**, and $1.34 maximum. All change percentiles
above describe observed movement, not prediction error or verified corrections.

**709 of 933 newly missing quotes (76.0%)** had been **47–48 hours old** in the
previous sweep. That is 33.3% of the 2,128 quotes initially in that age band.
This supports the earlier observation of a reporting/expiry boundary near two
days, but many older quotes remain available: it is not a universal expiry rule.

## Actual sampling intervals

The interrupted 00:00 sweep finished at 00:41:13 UTC; the next sweep finished at
01:14:33 UTC. Corresponding stations were observed **33.28–60.04 minutes apart**,
with a **33.49-minute median**. **93,700 of 141,660 stations** had intervals below
40 minutes. Therefore the smaller change fraction than the previous report is
not evidence of a slowdown in price changes.

The baseline-to-latest comparison has much more uniform intervals:
**179.95–180.04 minutes**, median 180.00 minutes. Both comparisons use actual
per-station observation timestamps.

## City cheapest-choice reliability

The repeated city sample now contains **172 checks, 3,440 station observations,
and 501 unique stations** across 24 cities. The current city hour is still in
progress, so cities do not all have the same number of observations.

There are **6 price-only cheapest-choice losses among 605 comparable transitions
(0.99%)** using at least five common priced stations, matching fuel/payment type.
Four losses occur regardless of which initially tied cheapest station is chosen;
the other two depend on tie-breaking. These are not independent random samples
and do not estimate the nationwide or app-specific recommendation failure rate.

The newly included worst case is **Fort Worth QuikTrip**:

- Midgrade credit moved **$4.19 → $4.39** while Texaco was $4.19.
- Premium credit moved **$4.49 → $4.69** while Texaco was $4.49.
- QuikTrip and Texaco were tied initially. The analysis's deterministic station-ID
  tie-break selected QuikTrip, producing a **20¢/gallon** later gap in each grade,
  or **$3 on 15 gallons**. These are two grade comparisons at one station event.
- The previous reports were approximately **29.82 hours old**. The change was
  observed between 22:31 and 23:31 UTC, after the prior report's export cutoff.

The previous maximum was 10¢. **The 95th percentile across all 605 comparisons is
still zero**, because losses occupy less than 5% of comparisons. Report the loss
frequency and individual worst cases alongside that percentile. These gaps are
relative to later reported alternatives, not verified customer overpayment.
Membership, travel distance, preferences, and stations missing from either
observation are outside this price-only audit.

The city history has **35 price changes across 22 stations**, versus 32 across 21
in the previous report. **517 of 552 timestamp advances (93.66%) repeated the
same price**. A repeated price can be correct; this is not a fraud label.

An independent PostgreSQL calculation reproduced **605 comparisons, 6 losses,
0¢ p95, and 20¢ maximum** at the exact export cutoff. See
`city-ranking-audit.sql` and `city-ranking-audit.json`.

## Verification and reproducibility

The saved manifests identify every private immutable archive path and SHA-256.
The shared archive auditor checks actual bytes, schema, exact ordered station
IDs, regional provenance, observation windows, duplicate absence, and priced
counts. A separate JavaScript implementation checks the Python comparison's
quote-change counts and distinct changed-station count.

The initial parallel archive verification downloads encountered a Supabase
Storage gateway HTTP 429. Downloads stopped and resumed sequentially at a
slower pace, retaining/checking completed files; incomplete local files were
replaced and hash-verified. This was analysis read-back traffic, not a GasBuddy
provider failure or a lost collection. No extra provider requests were made.
`auditHour.mjs` now accepts a downloaded-directory argument to run its existing
checks without downloading the same immutable objects again.

All **216 distinct archive objects** across runs 22, 142, and 177 passed those
checks. Both independent quote comparisons matched exactly. The existing two
archive-validation tests passed; the new offline audit mode was exercised on
all three real runs and rejected a deliberately mismatched run ID while
preserving input files. The city export count matches its frozen health snapshot.

At the health-check cutoff, all **four national sweeps** were complete with zero
missed batches or wrong-region jobs. Run 177 needed 72 attempts with no retries.
Both collectors had active dispatcher/watchdog schedules, no current cooldown,
and zero missed city slots. Archived storage was **14,689,484 bytes (1.63% of the
900 MB cap)**. The original October 7 collection deadline is unchanged.

To reproduce, expand `manifest-RUN.json.gz` into `manifest.json` in a directory
for each run, download each listed object from private `fuel-national` Storage
at its original relative path, and place the saved `cities.json.gz` in the run
177 directory. Then run:

```sh
node scripts/national-prices/auditHour.mjs 177 new-audit.json RUN177_DIR
python3 scripts/national-prices/comparePriceHours.py RUN142_DIR RUN177_DIR new-hourly.json
python3 scripts/national-prices/comparePriceHours.py RUN22_DIR RUN177_DIR new-baseline.json
python3 scripts/national-prices/analyzeEarlyPrices.py RUN177_DIR new-snapshot.json
node scripts/national-prices/verifyPriceComparison.mjs RUN142_DIR RUN177_DIR new-hourly.json new-independent-audit.json
```

The catalog remains a fixed cohort with the documented Texas/DC geographic
coverage assumptions; the Texas ID count is one above the provider aggregate.
Missing quotes do not mean station closure. Grade/payment quotes can update
together and must not be counted as independent reporting events.
