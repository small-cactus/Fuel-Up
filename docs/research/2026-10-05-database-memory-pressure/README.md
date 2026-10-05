# Recurring database stalls: memory pressure investigation

Investigated October 5, 2026, after the 14:32 UTC incident and restart documented in `../2026-10-05-1432-database-incident/`. Project `vjindchxfebaltbslqwc`; all times UTC.

## Finding and limits

The strongest supported cause is memory pressure and severe OS swapping on the Free/Nano database while it serves the app and ingests nationwide observations. This is not a phone rendering diagnosis. We directly measured the resource failure mode after restart; the exact pre-restart process-level allocation/OOM history was unavailable, so we cannot prove that every previous outage had an identical trigger.

The live infrastructure page showed Nano, up to 0.5 GB RAM. Host metrics report 431,304,704 bytes (411 MiB) usable physical memory and roughly 1 GiB swap. The prior incident's dashboard showed 1.47 GB memory commitment and failed database TCP health checks. A restart restores service but does not enlarge the machine or remove the workload.

Between saved resource snapshots at 14:51:04 and 14:54:36:

- 2.372 GB paged in and 2.209 GB paged out, using the explicit 4 KiB host-page assumption.
- 290,042 major page faults and 39.7% aggregate CPU time in IO wait.
- System/swap disk read 3.454 GB, wrote 2.214 GB, busy for 125.6 seconds.
- Database disk read 416 MB, wrote 239 MB, busy for 11.2 seconds.
- No new OOM-kill counter increment in this interval. Zero OOM kills after restart does not establish the pre-restart cause.

This is active swap churn, not merely an allocated swap file. System-disk activity greatly exceeds database-disk activity. See `pressure-before.json` and the two resource-only metric snapshots.

## Workload responsible for most database work

Retained `pg_stat_statements` counters started October 4 at 10:52:53, verified separately in `verify.json`. They are cumulative totals, not instantaneous rates or measured CPU time:

- `publish_fuel_station_batch`: 1,962 calls, 95 minutes total elapsed execution, 8.226 GB WAL, 441,632 temporary 8 KiB blocks written/read (about 3.62 GB each).
- `fuel_station_metadata_needed`: 2,025 calls, about 40 minutes total elapsed execution.
- Station projection: 4.037 million row updates, 450 autovacuum runs; table plus indexes about 194 MB.
- Price lookup: 981,872 updates; table plus indexes about 94 MB.
- Home's nearby query accounted for far less work than national ingestion.

The metadata query plan demonstrates 2,000 individual heap lookups for one batch. The trend plan demonstrates carrying wide price JSON through a two-pass aggregation and spilling to temporary files. Those repeated operations, hourly JSON/index updates, maintenance and the Supabase services compete for the same tiny memory pool. There was no evidence in the inspected snapshot of a persistent lock backlog or connection-limit exhaustion. Table occupancy is not a direct RAM requirement; these measurements do not by themselves establish an exact required compute tier.

## Deployed mitigation

Migration `20261005152000_narrow_national_trend_aggregation.sql`, deployed at 15:02:12, narrows the materialized eligible-price rows to station ID, fuel product and price before the E85 aggregation. It retains exact archive/coverage guards, source SHA, freshness, payment choice, duplicate-grade filtering, E85 availability and replay semantics.

The measured batch went from 242 temporary blocks written and read to zero. End-to-end read-only plan elapsed time was 1,080 ms before and 1,641 ms after, including live payload construction under varying IO pressure; this is **not evidence of a latency improvement**. The demonstrated improvement is elimination of that spill, without raising per-query memory limits.

This mitigation is **not a complete capacity fix**. At 15:06:29, a subsequent 60.8-second interval still measured 581 MB paged in, 524 MB paged out and 48.0% CPU IO wait. Four post-deployment serving timeout events remained; inspected jobs were nevertheless archived successfully and summarized through recovery. Do not label the incident permanently resolved based on successful endpoints or this patch alone.

## Verification

- `node scripts/national-prices/testTrendAggregation.mjs`: three-region baseline/candidate parity plus deterministic freshness, cash/credit, duplicate-grade, E85-without-current-E85-price, replay, invalid coverage and unarchived-job cases; all fixture and function changes rolled back.
- 25 archive/projection/region/Home-cache unit tests passed, plus 3 metrics interpretation tests. The latter prevent rebooted, missing or cached counters from being called healthy zero-activity intervals.
- Deployed definition and migration history verified.
- Scheduled 15:00 run advanced to 19/72 batches at the saved status check, still before its deadline. The 14:00 run completed all 72 batches at 14:57:26.
- Five recent post-deployment jobs in `verify.json` have matching archived summaries.
- Immutable archive read-back verified one batch per fixed region. East was collected after deployment; the west regions had finished earlier. This is sampled archive verification, not an all-hour or pump-price-truth audit.
- Home returned 155 Tampa regular-price stations in 991 ms and 495 ms. No phone launch or visual verification was performed.
- No provider collection was manually triggered. Research windows, budgets, routing, archive data and production ranking were unchanged.

## Capacity option declined

The live dashboard requires Pro to change compute. Recommended next step: Pro plus Small (2 GB RAM), approximately $30/month base before tax ($25 Pro + roughly $15 Small minus $10 compute credit), assuming the organization's one project and existing credits. The user chose to keep the current plan. No paid upgrade was purchased or applied. The existing server was tuned as described below. Small provides more headroom than Micro's 1 GB against the observed commitment, but improvement still needs verification after the resize.

A future resize still needs explicit authorization. Continue monitoring actual swap/IO pressure; a single successful request is insufficient. Do not extend the research windows.

Repeatable read-only diagnostic:

```sh
node scripts/operations/databasePressure.mjs 60
```

It obtains the existing service credential in memory, calls only the authenticated Supabase resource-metrics endpoint, and outputs sanitized counters. It does not collect provider data. If counters do not advance, the result is explicitly inconclusive rather than idle/healthy.

Sources: [Supabase memory/swap explanation](https://supabase.com/docs/guides/troubleshooting/memory-and-swap-usage-explained-aPNgm0), [compute sizes/pricing](https://supabase.com/docs/guides/platform/compute-and-disk), [billing credits](https://supabase.com/docs/guides/platform/billing-faq), plus authenticated project infrastructure and billing pages inspected during this investigation.


## No-cost configuration mitigation after the user declined an upgrade

Supabase generated `shared_buffers=224MB` (28,672 8 KiB pages) with no existing custom overrides. This reserves about 54.5% of the host's 411 MiB physical RAM for PostgreSQL's shared cache alone. PostgreSQL's documentation recommends leaving more room for the OS on machines below 1 GB. Given heavy system/swap IO and comparatively low database-disk utilization, we tested trading some database cache for process/OS headroom.

Applied only `shared_buffers=96MB` through the supported Supabase CLI; all other settings and the Free/Nano plan remain unchanged. PostgreSQL restarted at 15:11:34. The running setting is 12,288 8 KiB pages with `pending_restart=false`; the 60-connection limit and 2,184 KiB work memory were unchanged. The first health query during shutdown failed normally; subsequent queries confirmed startup and the new setting. No extra restart was issued.

At 15:12:20, scheduled collection had reached 55/72 batches; at 15:13:49 it reached 63/72, with zero missed batches. Home returned prices in 1,350 ms and 830 ms while collection continued. Archive read-back again verified all three fixed regions, with the east sample after this configuration restart; the western samples had already completed.

The first advancing 61.3-second resource interval after the change measured 250 MB swap-in plus 214 MB swap-out, with 20.3% CPU IO wait, compared with 581 MB + 524 MB and 48.0% before the configuration change. This is an encouraging reduction, **not** a controlled causal benchmark: both restart effects and batch mix can influence it, and significant swapping remains. Do not claim the daily recurrence permanently fixed until subsequent collection cycles remain healthy.

Repeat/rollback commands and safety boundaries are in `scripts/operations/README.md`. Review or remove this Nano-specific override if compute is resized later. No paid plan or compute change was made.

Configuration references: [Supabase supported custom settings and restart behavior](https://supabase.com/docs/guides/database/custom-postgres-config), [PostgreSQL shared buffer sizing](https://www.postgresql.org/docs/current/runtime-config-resource.html).


### Subsequent verification

- A second advancing 61.0-second interval at 15:16:04 measured 254 MB swap-in plus 261 MB swap-out and 20.3% CPU IO wait. The observed reduction persisted into the end of the scheduled sweep, but substantial swapping remains.
- Run 5982 completed all 72 batches / 141,660 IDs at 15:15:34 with zero missed batches. All matching derived summaries were present; the ten Trends scopes advanced to that run at 15:17:00. The latest saved serving timeout remained 15:10:11, before the configuration restart.
- Regular, midgrade, premium and diesel returned successful validated responses. The generic all-grades probe stopped on E85 because it incorrectly requires every station to have a numeric price. A focused E85 check returned HTTP 200 with 13 stations, ten legitimately unpriced E85-capable stations and no invalid numeric prices. This is the existing availability policy, not evidence that all-grades probe passed. No assertion was weakened and no production price rule changed.
- The 24-city campaign remained active, with no overdue work at 15:12, unchanged 54 historical missed slots and 55,080 observations. The next city-hour window starts at 15:19.

Two missing 14:00 run summaries were subsequently recovered, after the 15:00 sweep completed, from SHA-verified immutable objects using the existing guarded `record_fuel_national_trend_batch` RPC. Run 5936 now has all 72 matching summaries. Only previously missing derived totals were inserted; no raw observations or serving-station rows were changed, and there were zero provider requests. See `recovered-history.json`.

## Final status for this intervention

Two tested mitigations are live: narrower trend aggregation and a smaller shared cache on the same Free/Nano server. The immediate checks improved and the scheduled sweep completed. Significant swap activity remains; a daily no-recurrence claim is not established. Keep monitoring later scheduled cycles under real load, especially the next full sweep. A paid upgrade remains declined, with no pending approval or purchase.
