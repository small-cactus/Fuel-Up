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
