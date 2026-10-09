# Provider errors during the October 9 22:00 UTC operational sweep

Read-only monitoring at 22:38 UTC found run 12012 still running before its 23:00 UTC deadline, with 66/72 batches archived successfully (129,960/141,660 fixed-inventory IDs). This is not yet a finalized partial-hour result. However, three East batches are already terminally missed after three attempts each, so this is a consequential new collection incident rather than ordinary current-hour progress.

## Evidence and cause

- Saved responses show HTTP 503 after approximately 10–11 seconds, with Retry-After: 5. There are 13 HTTP-503 events and two transient GraphQL events for this run; failures are retained, not counted as successful batches.
- East ordinals 53–55 exhausted three attempts. Ordinals 56–57 remain queued after one failed attempt, and ordinal 58 has not started. West regions completed 9/9 and 4/4 batches with correct provenance.
- Consumed lookup budget is 159,960 of 161,660 (81 of 92 request attempts). The next queued batch requires 2,000 lookups but only 1,700 remain. The committed claim function selects the earliest eligible job and refuses work exceeding the approved budget. No quota increase, retry reset, queue reordering, manual collection or route change was performed.
- Latest complete Trends cache remains run 11952 (21:00 UTC), published at 21:15 UTC for all ten scopes. It has no missing batch projections. The incomplete sweep has not replaced it.
- Collection remains enabled and continuous; all five schedules are active. Shared cooldowns are expired, no new unresolved operational projection repairs or recent HTTP scheduling errors were found, and no national cron failures occurred after the previously reported 09:21 database restart.
- Accounted archive usage is 749,025,238 / 900,000,000 bytes. Retention last returned HTTP 200 at 22:30 with no eligible objects left. Preserved research history was not modified by monitoring.

## Disposition

The blocker is upstream unavailability combined with bounded retries and the existing hourly lookup budget, not a stopped collector requiring re-enablement. Leave the limits intact and inspect the next scheduled hour for recovery. No repair/deployment was attempted, and no provider request was issued by this monitor. Verification used the protected status report, actual job states, recorded response evidence, and supplemental database/cron/retention health queries; no code changed, so unit tests were not needed. Archive read-back remains required if a later recovery needs verification.

The prior 51 operational hours are complete with no expired missing slots. This run is still before its deadline; the next monitor must report its final outcome separately from any recovery. Fixed inventory observations do not establish verified pump prices.

## Scheduled recovery verified at 23:38 UTC

The next scheduled run, 12072 for 23:00 UTC, completed all 72 batches at 23:17:19 without operator collection or configuration changes. It used 73 worker attempts and preserved all three regional routes. All ten Trends scopes published the complete run at 23:19; missing batch projections and unresolved operational repairs are zero. Schedules, cooldowns, capacity, and the 23:30 retention invocation remain healthy.

`node scripts/national-prices/auditHour.mjs 12072 /tmp/fuel-national-recovery-2337-audit.json` downloaded and verified all 72 immutable archives: hashes, schema, exact catalog IDs and regional provenance passed. Coverage is 141,660 IDs, with 92,661 priced and 48,999 unpriced provider observations; compressed archives total 3,641,374 bytes. This proves stored collection integrity, not pump-price truth.

The 22:00 run finalized partial at 23:00: 66/72 batches, 129,960 observed IDs, six missing batches (11,700 IDs). Its evidence remains preserved; it was not backfilled or represented as complete. Across all 53 expected operational hours, 52 are complete and one partial, with no absent or expired-running slots. No repair or deployment was required for recovery.
