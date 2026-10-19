# Verified read optimization — October 19, 2026

The compact-read migration is deployed. One full live read-optimized nationwide sweep and its archive/serving checks passed. Measured metadata/publication page reads fell **81%**, but host swapping remains substantial. This is not proof that the free instance cannot lock up again, nor a claim that multiple subsequent scheduled read-optimized sweeps have passed.

## Full live comparison

The baseline is the normal 19:00 UTC sweep after the earlier write-deduplication deployment. It completed 72 batches and 141,660 fixed-inventory stations at 19:15:46; Trends published at 19:16:00. The read migration deployed at 19:18:05, then all 141,660 compact records were prepared and checked. The user-authorized extra live sweep started at 19:22:42, completed at 19:37:44, and published Trends at 19:38:00: **15 minutes 3 seconds including dispatch, followed by 15 seconds to Trends**.

Both counter intervals contain exactly 72 successful metadata RPCs and 72 successful publication RPCs. Figures below are PostgreSQL shared-buffer reads, which can be served by the operating-system cache; they are **not total physical disk I/O**.

| Measured work | Baseline | Read optimization | Difference |
|---|---:|---:|---:|
| Metadata page reads | 670.0 MiB | 19.1 MiB | 97.2% fewer |
| Publication page reads | 223.1 MiB | 150.9 MiB | 32.4% fewer |
| Combined page reads | 893.1 MiB | 170.0 MiB | 81.0% fewer |
| Metadata execution time | 94.3 s | 5.9 s | 93.7% less |
| Publication execution time | 74.6 s | 89.0 s | 19.3% more |
| Combined recorded execution time | 168.9 s | 94.9 s | 43.8% less |

These are sequential live sweeps with fresh provider responses. Quote-change frequency, cache warmth and background maintenance differ, so this is an observed workload comparison, not an isolated hardware benchmark. Failed/canceled work is not necessarily represented by successful-statement execution counters. Fixed provider pacing also limits how much database speedup changes total collection duration.

The read-optimized sweep changed **4,038 of 141,660 station rows**, 97.15% fewer than rewriting every checked station. This percentage varies with actual changes. The separately verified earlier write-optimization sweep changed 9,669 rows, a 93.17% reduction. Neither figure is a percentage reduction in total disk writes.

## What changed

- A private derived collection-state table stores metadata availability, E85 availability, exact price-JSON SHA-256, base observation time and batch membership. Unchanged ordinary price-only payloads avoid wide station reads. Changed, noncanonical, metadata-bearing and unprepared rows retain the exact prior merge path.
- Transactional triggers synchronize state with station changes, including independent E85/metadata changes. An admin-only bounded preparation helper leaves prices and observation times unchanged. Freshness still advances once per verified batch, after successful publication.
- Batch Trends E85 checks use narrow state with a safe fallback.
- An exact archive-manifest index reduces its working set. The independent Storage-object accounting and conservative invalid-size reserve remain intact. No capacity checks were weakened.
- Nearby queries conservatively narrow longitude as well as latitude before the unchanged exact-distance filter; date-line and pole crossings are covered.
- Resource monitoring now records CPU modes and available/free/cache memory, while retaining unknown/cached-counter and reboot safeguards.

No billing, hosting, regional routing, provider identity, cooldown, raw-price or retention-policy changes were made. The phone app was not opened.

## Verification

- All original SQL safety/parity checks passed, plus compact-state fallback, synchronization, rollback, stale retry, numeric equivalence, archive accounting and permissions.
- Thirty exact geographic comparisons passed across several radii, date-line crossings and both poles. Three live candidate-query comparisons also returned identical results; they used roughly 21–50% fewer logical page visits. Their sequential warming prevents attributing all elapsed-time differences to the filter.
- A replay of 6,000 saved real stations preserved serving and Trends output. All 39 targeted Node tests and all 3 resource-metric tests passed.
- The five replaced live functions matched the checked-in baseline. Deployment was atomic with bounded lock and statement timeouts.
- All 141,660 prepared compact records matched station metadata, availability, price signatures and observation membership. A broad verification query exceeded its 15-second timeout; the check then completed through bounded four-batch read-only queries.
- All **72 immutable archives** passed hash, byte size, ordered station coverage, observation-window and assigned-region checks: 72 provider attempts, 141,660 unique catalog stations. East: 59 batches; southwest: 9; northwest: 4.
- All batch summary source hashes, freshness receipts and changed-station signatures matched. All 72 batches were published and summarized, with **zero final projection backlog**.
- During collection, 24 public nearby checks passed in Clearwater, New York, Los Angeles, Seattle, Honolulu and Anchorage at 2, 5, 10 and 15 miles. Checks covered radius inclusion, uniqueness, distances and real unexpired quotes. These serving calls use only the database cache.
- After completion, all three regional public responses passed (0.80–1.76 s in those samples). National Trends responded in 0.45 s, and all ten fuel/E85 history combinations matched stored complete-sweep totals.
- All five schedules remain active, including retention. Accounted archive capacity was 679,011,673 of 900,000,000 bytes. The operational status window showed zero expired absent/running slots; previously reported historical partial hours remain unchanged.

## Remaining limitation: memory and total I/O

The final event audit found **four publication client timeouts**, all recovered before final verification. Earlier progress messages describing only the first timeout were incomplete. The baseline normal sweep had two such timeout events. Do not report the optimized sweep as timeout-free.

Thirteen advancing resource samples ending before collection completed showed CPU disk wait ranging from **9.1% to 35.9%, median 12.4%**, about **3.40 GB swapped in and 3.41 GB swapped out**, and no sampled OOM kills. The latest in-run CPU sample was 81.4% idle and 14.9% I/O wait. Background maintenance overlapped early pressure; causal attribution is not established. Post-run archive auditing is excluded from these collection samples.

The available pre-change host sample is not a complete matched baseline. Therefore **no measured reduction in total host disk traffic or elimination of memory pressure is claimed**. CPU compute was not saturated in the sampled intervals. Connection and index footprints were recorded; index size alone does not establish bloat, and no speculative index rebuild or connection termination was performed. The next normal hourly sweep will provide ongoing evidence through the existing monitor.

Earlier voice statements claiming completed multiple scheduled read-optimized runs, zero swapping, two-minute publication delay, or 34-minute completed sweeps were not verified and are superseded by the saved evidence here.

## Reproduction and evidence

`node scripts/national-prices/testStationDedup.mjs` tests the deployed compact path by default. Set `FUELUP_TEST_READ_BENCHMARK=1` to add the disposable 141,660-station/96 MiB-buffer benchmark; `FUELUP_TEST_COMPACT_COLLECTION=0` retains the earlier write-only comparison. An optional saved-archive argument enables the three-region real-data replay.

The local large-table benchmark reduced publication shared reads from 17,407 to 241 blocks for unchanged batches and from 17,536 to 463 for 10% changed. The local contiguous metadata case was not faster (1.82 ms versus 2.91 ms). These local PostgreSQL/warm-OS-cache results are preserved but do not replace the live comparison.

Primary evidence: `read-comparison.json`, before/after statement counters, `read-live-progress.json`, `read-live-archive-audit.json`, `read-final-integrity.json`, public serving/history results, and `pressure-read-live-series.json`. The temporary verification allowance expires at 20:00 UTC; ordinary hourly budgets remain 92 requests and 161,660 lookups.

Coverage is relative to the fixed catalog. These are archived provider observations, not verified pump truth or proof of undocumented provider inventory completeness.
