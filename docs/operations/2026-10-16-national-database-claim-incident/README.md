# National database-claim recurrence — October 16

Observed 2026-10-16 16:26–16:31 UTC after the preceding scheduled 15:00 sweep completed at 15:17:36. This is a new recurrence after the October 15 verified recovery, not evidence that the earlier incident never recovered.

## Impact and completeness

The 16:00 run (21273) has 23 successful batches and 49 queued batches out of 72. Its last recorded provider request was at 16:05:01. It remains within its deadline until 17:00 UTC and is not yet a newly missed hour. Reconciliation from the October 7 19:00 operational start found 214 expected slots: 192 complete, 21 previously reported partial, one current running slot, zero absent expired slots, and zero expired running slots. These counts use all currently retained run rows; later metadata retention must not be interpreted as new missing collection.

The latest complete run is 21213 (15:00); its ten-scope Trends cache published at 15:21 and has zero projection backlog. A cache-only public request timed out after 25,007 ms, so successful public delivery was not verified during this check.

## Saved failure evidence

- Saved east-worker responses at 16:18, 16:21, and 16:22 returned HTTP 503 with DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED. Expected and actual region both equal us-east-1. These are internal claim failures, not proof of a new provider denial.
- Retention cron dispatches at 16:10 and 16:20 failed with job startup timeout; 16:00 succeeded. Active scheduling alone does not establish successful cleanup.
- Both the full status query and a separately bounded ten-second read failed with SQLSTATE 57014 in fuel_national_archive_bytes. Current exact archive usage and eligible retention backlog remain unverified. The ten-second limit was session-local to the diagnostic read; no production setting changed.
- A narrow 16:30 database activity snapshot showed two active queries, eight idle connections, and two extension waits. It does not establish lock contention or connection exhaustion.

All six national cron schedules remain active, including dispatch, watchdog, projection repair and retention. All three fixed regional routes are enabled and retain their expected function/region mapping. East dispatch advances; this does not prove collection succeeds. The current hour has consumed 24 request attempts and 45,960 lookup attempts, below limits of 92 and 161,660; the preceding complete hour consumed 74 and 145,660. Shared cooldown expired at 15:10:59; enabled=true and continuous=true remain intentional. The stored UPSTREAM_HTTP_503 reason predates these internal failures and was not cleared or overridden.

## Action and repair boundary

No production repair was attempted in this recurrence (zero attempts). The October 14 Storage-table index attempt was rejected because the role did not own storage.objects; it was not retried. The present evidence confirms recurring database/accounting failures but does not establish a safe code repair or underlying platform cause. A database/Storage performance investigation remains necessary if scheduled retries do not recover.

No provider collection, replay, re-enable, billing change, restart, route change, raw overwrite, deletion or research-window mutation was performed by this monitor. The original research window and city campaign remain closed. Existing retention policy remains 48 hours for operational raw objects and eight days for operational metadata, preserving original research, evaluation data and the latest published cache archive. No recovery or new immutable archive read-back is claimed; verify both on a new scheduled recovery.

The inventory assumption remains 141,660 catalog stations in 72 batches across three fixed routes. These are provider observations, not verified pump truth. snapshot-1630.json contains sanitized read-only evidence and excludes credentials and tester telemetry.

## 17:23 UTC follow-up — first newly incomplete hour

The 16:00 run closed partial at 17:01:04 with 23 succeeded and 49 missed batches. Its 43,960 observed catalog stations include 29,051 with some reported price; this is neither a complete nationwide sweep nor verified pump truth. The all-retained operational reconciliation now has 215 expected slots, 192 complete, 22 partial, zero expired absent slots and zero expired running slots. The eight-day rolling status window separately contains 192 expected slots, 169 complete, 22 partial and the current running slot. Both views agree on the new incomplete hour; older retained rows outside the rolling window are not additional gaps.

The current 17:00 run (21307) has 72 queued jobs, zero attempts and no successful batches. Its deadline is 18:00 UTC, so it is not counted as missed yet. The last provider request remains 16:05:01. Saved HTTP 503 database-claim failures now cover all three fixed routes (us-east-1, us-west-1 and us-west-2), with matching expected/actual regions. All six schedules and three routes remain enabled, dispatch timestamps advance, and the shared cooldown remains expired with no newer saved provider denial.

The complete 15:00 Trends cache remains the latest published cache across ten scopes and has zero missing projection batches. The public cache-only request now succeeded (HTTP 200, 6,071 ms, no history error) and returned the 15:00 regular-grade point. This verifies cache access only, not collection recovery.

The full status read succeeded this time: accounted archive usage is 761,415,871 of 900,000,000 bytes (84.6%), with 72 eligible retention objects. A separate ten-second bounded retention diagnostic still timed out. Retention cron dispatches at 17:00 and 17:10 failed startup; 17:20 succeeded, but dispatch success does not prove deletion completed. The observed eligible-object backlog remains unresolved in this snapshot.

No speculative production repair, provider replay, re-enable or policy change was attempted. Repair attempts for this incident remain zero. Database performance is intermittent, the underlying cause remains unproven, and scheduled collection has not recovered. The evidence is saved in followup-1723.json. Existing research and retention protections remain unchanged.

## 18:22 UTC follow-up — second incomplete hour in this recurrence

The 17:00 run (21307) closed partial at 18:02:06 with one successful batch and 71 missed batches. Only one provider attempt (2,000 station lookups) was recorded; the last request advanced to 17:33:04. This is limited progress, not a complete sweep or recovery. The 18:00 run (21339) has 72 queued jobs and zero attempts and remains within its deadline until 19:00 UTC.

All-retained operational reconciliation now finds 216 expected slots: 192 complete, 23 partial, the current running slot, zero expired absent rows and zero expired running rows. The 16:00 and 17:00 slots are the two newly incomplete hours in this recurrence; the preceding 21 partial hours remain historical. Latest complete cache remains the 15:00 run, published at 15:21 across ten scopes, with zero latest-complete projection backlog. The public cache-only request timed out after 25,009 ms this check; the prior successful public response does not establish current availability.

Initial full status and narrow administrative reads failed HTTP 544 while creating the login role due to connection timeout. Retried narrow reads succeeded. Saved database-claim HTTP 503 failures at 18:20–18:22 again cover all three fixed execution regions with matching expected and actual region. All six national schedules remain active, including the main dispatch and watchdog; enabled/continuous configuration remains intentional. Shared cooldown expired at 15:10:59 and was not overridden. No new provider denial is established by these internal errors.

Retention dispatches at 18:00 and 18:10 failed startup; 18:20 succeeded. Actual cleanup completion and current eligible-object backlog could not be verified. A bounded ten-second capacity query failed SQLSTATE 57014 inside fuel_national_archive_bytes. The prior 761,415,871-byte capacity observation and 72 eligible objects belong to the 17:23 snapshot and are not restated as current values.

No production mutation or repair was attempted; repair attempts in this recurrence remain zero. Saved evidence continues to support intermittent database/Storage performance failure, but does not establish a safe code fix or underlying platform cause. No owner-only index request was retried, no capacity/cooldown protections were bypassed, and no manual collection, replay or research-data change occurred. Immutable archive read-back remains pending a new scheduled recovery. Sanitized evidence is in followup-1822.json. Counts refer to fixed-inventory provider observations, not verified pump truth.

## 19:23 UTC follow-up — third incomplete hour, retention backlog growing

The 18:00 run (21339) closed partial at 19:01:01 with all 72 batches missed and zero provider requests. The 19:00 run (21376) has 72 queued jobs and zero attempts; its deadline is 20:00 UTC, so it is not yet counted as missed. Last provider request remains 17:33:04. This recurrence now accounts for three incomplete hours (16:00–18:00), in addition to 21 previously reported partial hours.

All-retained operational reconciliation shows 217 expected slots: 192 complete, 24 partial, one current running, zero expired absent slots and zero expired running slots. The eight-day rolling view separately shows 192 expected slots, 167 complete, 24 partial and the current running slot. The different complete counts reflect the rolling window, not newly missing rows.

Saved database-claim HTTP 503 failures at 19:20–19:22 cover all three fixed routes with correct expected/actual region. All six schedules and all three routes remain active. Shared cooldown remains expired, and the latest saved events contain no newer provider denial after the 15:10 transient HTTP 503. Both the 18:00 and current 19:00 runs have zero request/lookup budget consumption. No schedule restoration or re-enable is needed or performed.

The full status query eventually succeeded. Accounted archive usage is 761,463,184 of 900,000,000 bytes (84.6%). The retention function returned 200 candidates, its SQL LIMIT 200: this means **at least 200 eligible objects**, not an exact total. The previous 17:23 snapshot returned 72. No job archive deletion was recorded since this incident began; the latest recorded archive_deleted_at is October 15 at 19:00:04. This database metadata observation does not independently prove which objects physically remain in Storage. Retention cron dispatches at 19:00 and 19:10 failed startup; 19:20 succeeded, but cleanup is not verified by dispatch success.

Latest complete Trends cache still references the 15:00 sweep across ten scopes, with zero latest-complete projection backlog. The cache-only public request succeeded with HTTP 200 in 2,371 ms and no history error, returning the 15:00 regular-grade point. Public cache access has resumed for this request; national collection has not recovered.

No production repair was attempted; incident repair attempts remain zero. Underlying database/Storage slowdown remains unproven, and no safe code repair is established. No provider replay, capacity bypass, owner-only index retry, raw overwrite, deletion, route change or research-window mutation occurred. Recovery and immutable archive read-back are not claimed. Evidence is saved in followup-1923.json; fixed-inventory observations are not verified pump truth.

## 21:20–21:22 UTC follow-up — two further incomplete hours

This check was triggered by the 20:27 heartbeat but the actual database observations are from 21:20–21:22 UTC. The 19:00 run (21376) closed partial at 20:00:01, with one successful batch and 71 missed batches (two attempts across all jobs). The 20:00 run (21412) closed partial at 21:00:04 with all 72 batches missed and zero attempts. Last recorded provider request is 19:25:33. Neither single-batch progress nor advancing dispatch establishes recovery.

All-retained operational reconciliation now has 219 expected slots: 192 complete, 26 partial, one current running slot, zero expired absent rows and zero expired running rows. Five partial hours now belong to this recurrence (16:00–20:00), beyond the preceding 21 partial hours. The current 21:00 run (21445) has 72 queued jobs and zero attempts, with its deadline at 22:00 UTC; it is not counted as missed. Both 20:00 and 21:00 have zero provider request and lookup budget usage.

All six schedules and three fixed routes remain active with matching expected and actual worker regions. Saved 21:16–21:18 responses show database-claim HTTP 503 failures across all three routes. The shared cooldown remains expired at 15:10:59, continuous=true and enabled=true remain intentional, and no newer provider denial appears in the latest saved events. No watchdog restoration or re-enable is indicated.

Latest complete cache remains the 15:00 run across ten scopes, published at 15:21, with zero latest-complete projection backlog. A cache-only public request succeeded with HTTP 200 in 12,828 ms and no history error, returning the 15:00 regular-grade point. This verifies that request, not collection recovery or general availability.

Initial full and narrow reads failed HTTP 544 creating the administrative login role; retried narrow reads succeeded. A session-local ten-second capacity read failed SQLSTATE 57014 inside fuel_national_archive_bytes. Current archive usage and retention eligibility remain unverified; prior 84.6% usage and at least 200 candidates belong to the earlier 19:23 snapshot. Retention cron dispatch succeeded at 21:00 but failed startup at 21:10 and 21:20. No cleanup completion is claimed.

Repair attempts for this recurrence remain zero. No safe code fix or underlying database/Storage cause is established. No provider replay, raw overwrite, deletion, restart, capacity/cooldown bypass, billing change, owner-only index retry or research-window mutation was performed. The five-hour recurrence requires database/Storage performance investigation; existing scheduled retries remain enabled. No immutable archive recovery read-back is claimed. Sanitized evidence is in followup-2122.json. These remain fixed-inventory observations, not verified pump truth.

## 22:28–22:43 UTC — collection recovery and scoped retention repair

Normal scheduled collection recovered before any repair deployment: run 21486 (22:00) completed all 72 batches at 22:17:15 using 72 requests / 141,660 lookups, within limits of 92 / 161,660. The 21:00 run remained partial (36 succeeded, 36 missed; 37 requests / 71,960 lookups), so this recurrence left six incomplete hours, 16:00–21:00. All-retained counts before metadata cleanup were 220 expected slots, 193 complete, 27 partial and no absent or expired running slots. The eight-day rolling view was 192 expected, 165 complete and 27 partial. Future intentional metadata expiration must not be counted as collection gaps.

The complete 22:00 Trends cache published at 22:21 across ten scopes, with zero missing projection batches. A cache-only public request returned HTTP 200 in 653 ms, no history error, and the 22:00 regular-grade point. All schedules and fixed routes are enabled, cooldown is expired, and no recent database-claim error matched the 15-minute response query. No re-enable, replay or provider collection was triggered by this monitor.

One immutable successful archive per fixed region from complete run 21486 passed size, SHA-256, exact station-ID, schema, window and provenance checks at 22:29:24. This is sample read-back; full-sweep completeness is independently established by 72 successful job rows. Observations of the fixed catalog are not verified pump truth.

### Retention did not recover with collection

Archive accounting was available at 766,834,194 of 900,000,000 bytes, and raw deletion candidates were zero. However, successful cron dispatch did not mean successful retention: saved workers at 21:40 through 22:30 returned NATIONAL_RETENTION_FAILED. No deletion acknowledgement had advanced since October 15 at 19:00:04. A bounded diagnostic transaction calling reconciliation failed SQLSTATE 57014 at the FOR-over-SELECT metadata-pruning query after 15 seconds; nothing committed.

EXPLAIN showed a correlated anti-join repeatedly scanning the approximately 162,000-row fuel_station_latest table for old run references. The referenced job_id column had no index. This also leaves foreign-key checks on deleted jobs without that index. The new migration adds only a concurrent B-tree index on public.fuel_station_latest(job_id). It does not modify retention eligibility, the research boundary, the latest-cache protection, raw objects, or any collection/billing setting. The prior rejected Storage-owner index proposal is unrelated and was not retried.

Repair attempt 1 deployed successfully through an individual Management API SQL command outside a transaction and was recorded in schema_migrations only after the index was confirmed ready and valid. A CLI invocation initially misparsed a leading SQL comment as an option before contacting the database; using --file resolved that invocation error, with no extra production repair attempt. Eight existing retention/archive tests passed. The unchanged reconciliation function then completed in 3,418 ms including CLI overhead, reporting 1,530 absent archives to acknowledge and four eligible old hours to prune; this verification transaction was rolled back. The normal scheduled retention dispatch must still demonstrate committed cleanup; no successful scheduled cleanup is claimed at this checkpoint.

The underlying cause of the broader intermittent database slowdown remains unproven. Collection recovered independently of this index; the index fixes the separately reproduced retention scan. Evidence and sample archive audit are in recovery-and-retention-repair-2243.json.
