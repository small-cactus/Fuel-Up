# Retention recovery — October 27, 2026

Scheduled retention returned HTTP 503 from 19:00 through 20:10 UTC. Collection continued: the 19:00 and 20:00 sweeps completed all 72 batches and the latest complete Trends cache had no projection backlog. No new overdue collection slots were found in the retained eight-day operational window. Older, intentionally pruned metadata is not evidence of missing collection.

The first large cohort of unchanged station contents reached the eight-day metadata boundary. Approximately 18,000 station rows still referenced the October 19 18:00 content jobs, even though newer batch receipts supplied their current observation provenance. A rollback-only diagnostic first timed out in retention's eligibility query. Its measured selection took 7,391 ms and read 11,478 shared blocks. The covering index reduced a later selection to 2,348 ms; these are diagnostic samples with different cache states, not a controlled performance benchmark.

Three scoped production repair deployments were used:

1. An 8,429,568-byte concurrent index covers `job_id`, observation membership and observation time. It leaves publication writable and preserves all retention predicates. The full function then exposed a second timeout in the foreign key's mass `SET job_id = NULL` update.
2. A function revision bounded detachment to 500 references per transaction. Its rollback preflight passed and five committed batches detached 2,500 references, but the sixth timed out and rolled back. The catch-up loop stopped immediately.
3. The final revision removes the initial full-cohort validation and caps writes at 100 references per transaction. Receipt coverage is checked when selecting each locked candidate. The limit bounds writes, not every row the planner might inspect if receipts are missing or stale. Any remaining station reference prevents deletion of its job/run, including missing or stale receipts and rows skipped because they are locked. Other protections are unchanged: original research/evaluation boundaries, 48-hour raw retention, eight-day metadata threshold, latest cache, current receipt jobs, active projection leases, advisory lock and four-run limit. Clearing an obsolete content-job reference does not change station payloads, prices, observation times or the current receipt.

The final revision passed a rollback-only production preflight within the existing ten-second timeout. The 20:20 scheduled worker returned HTTP 200, detached 100 references and reported one deferred hour with zero provider requests. Its `idle` string describes zero raw-object removals; the explicit metadata counters show the work performed. Bounded administrative calls then used the same deployed function to drain the incident backlog without waiting multiple hours for ten-minute scheduling. Each call commits independently, caps work at 100 references and stops on the first error. This catch-up does not call the provider or delete raw objects.

The monitor now includes actual retention worker responses, including `NATIONAL_RETENTION_FAILED`, plus counts of complete/partial operational runs past the metadata age threshold. These counts can include protected/deferred runs and are not unconditional deletion eligibility. Previously the supplemental success-only response filter hid failures behind successful cron dispatch and an empty raw-object candidate queue. Cron dispatch success alone is not worker success.

## Validation and evidence

- Eight retention/archive unit tests passed.
- The disposable PostgreSQL integration suite passed publication, freshness, retention, compact collection, geographic-result and budget/permission checks with the final migrations. New cases verify the 100-reference cap, partial drain/retry, stale receipts, mixed covered/uncovered references, deferred job retention and exact public-data equality across cleanup.
- `evidence.json` records the initial incident, timeout diagnostics, query-plan summaries, valid index, failed intermediate cleanup, rollback preflights and first successful scheduled worker.
- `archive-readback.json` verifies one immutable archived batch from each fixed region after the final repair using SHA-256, size, exact station IDs, schema and provenance. The 20:00 sweep was complete at selection. The separate 72/72 database totals establish sweep completeness; this three-batch read-back does not verify every archived object.
- `recovery.json` records final catch-up results, protected inventory comparisons and live service checks after cleanup.

No collector re-enable, provider replay, identity/routing change, denial/capacity override, billing change, raw-price rewrite, city campaign restart or phone-app launch was performed. Coverage refers to the fixed inventory, not verified pump truth. A full live station-content fingerprint query exceeded the client timeout and is not claimed as evidence; unchanged payload behavior is established by the scoped SQL and local exact-value tests. Research and pinned archive inventory fingerprints are checked separately.

## Final verification at 20:27 UTC

The final catch-up completed 157 successful calls, detached 15,545 references and pruned four expired operational run rows (including prior verification runs). The final call was empty. No eligible raw objects, overdue complete/partial metadata rows or unacknowledged removed archives remain. The 20:20 scheduled worker had already succeeded with a nonempty 100-reference metadata batch.

All 11,520 protected research jobs and 11,098 protected research objects retain their pre-repair inventory fingerprints, as do all 72 objects of the pinned 19:00 cache archive. The deployed function matches the final migration, all three migration versions are recorded, the index is valid/ready, and anonymous/authenticated execution remains denied. Scheduled collection remains enabled on all three fixed routes. The retained window contains 192 complete hourly slots, zero absent/partial/overdue running slots, and no projection backlog. The 20:00 sweep used 74 requests and 145,660 lookups, within 92 / 161,660 limits. Accounted archive usage is 742,100,761 / 900,000,000 bytes.
