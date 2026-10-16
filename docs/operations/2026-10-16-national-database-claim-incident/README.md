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
