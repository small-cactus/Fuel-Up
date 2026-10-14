# National collection database-claim incident

Observed October 14, 2026, 05:19–05:24 UTC. The preceding monitoring failures began around 03:07 UTC.

The service remains enabled in continuous mode and its dispatch timestamp advances. Its last recorded provider request was 03:04:00 UTC; the shared cooldown expired at 02:16:48 UTC. All national cron entries remain active. No configuration, billing, collection, raw archive, or research-window data was changed by this investigation.

## Confirmed impact

- The 02:00 sweep is complete and is the latest published public Trends history point.
- The 03:00 sweep is partial: 18 succeeded batches and 54 missed batches out of 72.
- The 04:00 sweep is partial: all 72 batches missed, with zero attempts.
- The 05:00 sweep was still within its deadline, with 72 queued batches and zero attempts at the diagnostic snapshot. Do not count this as a missed hour yet.
- These are two newly confirmed incomplete operational hours beyond the four previously known partial hours. Full absent-slot reconciliation and current retention/capacity/backlog verification remain blocked by intermittent database query timeouts.

## Diagnosis

Saved pg_net responses show HTTP 503 with `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED` from all three fixed regional workers. Expected and actual regions match: us-east-1, us-west-1, us-west-2. This identifies a failure before the provider request claim succeeds, not a new provider denial. It does not identify the underlying database failure.

The administrative full status query repeatedly times out with HTTP 524. Some small read-only queries succeed; another diagnostic query returned HTTP 544 with a database connection timeout. A pg_stat_activity snapshot showed one active query, nine idle connections, and two extension waits; it did not establish persistent lock contention or exhausted connections. The public cache request first exceeded 25 seconds; a later request succeeded with the older 02:00 sweep.

## Action and limits

No speculative deployment, collection replay, re-enable, database restart, deletion, routing change, or billing change was attempted. The existing enabled schedule continues to retry through its normal controls. Repair attempts: zero. No recovery or immutable archive read-back is claimed. On recovery, verify scheduled collection, all operational slots, the latest complete cache, projection backlog, retention, budgets, and a stored immutable archive before reporting recovery.

Coverage remains observations of the fixed station inventory, not verified pump truth. Evidence excludes credentials and user telemetry.

## 06:12 heartbeat follow-up

At 06:21 UTC the incident remains unresolved. Full reconciliation from the operational start found 156 expected hourly slots: 148 complete, seven partial (four previously known plus 03:00, 04:00, 05:00 from this incident), zero expired absent rows, zero expired running rows, and the current 06:00 running slot. The 05:00 slot missed all 72 batches with zero attempts; 06:00 still had 72 queued jobs and was not yet due. Last provider request remains 03:04 UTC. Recent saved worker HTTP 503 responses retain the database-claim failure and correct execution region in all three regions.

### Narrowed failure and repair boundary

The full status query now returned PostgreSQL 57014 statement timeout. A read-only call to `fuel_national_archive_bytes()` also exceeded a 10-second timeout. Its two unchanged accounting components were measured independently: the manifest sum took 8.221 ms; the Storage metadata sum exceeded ten seconds, then completed in 20,795.166 ms under a bounded 60-second diagnostic timeout. EXPLAIN ANALYZE showed 14,595 matching Storage rows, 1,140 shared buffer hits, and zero shared reads. No Storage relation locks appeared in a separate snapshot. These measurements identify the slow Storage scan but do not establish its underlying platform cause; disk I/O exhaustion is not proven.

One scoped repair attempt requested a concurrent covering partial index on `storage.objects(bucket_id) INCLUDE(metadata)` for the national bucket. It would leave the exact byte calculation, conservative malformed-size fallback, budget, and all raw objects unchanged. PostgreSQL rejected creation with SQLSTATE 42501, `must be owner of table objects`. No index was created. The unapplied migration was removed. No ownership/role changes, alternate privileged credentials, capacity bypass, or timeout increase to production functions was attempted. Total repair attempts for this incident: one, rejected before modification.

Resolving the managed Storage scan/index issue requires authorized table-owner or Supabase support intervention, unless another independently tested fix is found. Current retention execution, archive capacity, and projection backlog remain unverified because the full diagnostic path times out. No scheduled collection recovery or archive read-back is claimed.

## 07:17 heartbeat follow-up

The 06:00 sweep also missed all 72 batches with zero attempts, bringing this incident to four incomplete hours (03:00–06:00). Reconciliation found 157 expected operational slots: 148 complete, eight partial (four old plus four incident slots), zero expired absent rows, zero expired running rows, and the current 07:00 running slot. That current slot still had 72 queued jobs and zero attempts; it was not yet due. Last provider request remains 03:04 UTC.

All three fixed regional workers still return the database-claim HTTP 503 error with matching expected/actual regions. Collection remains enabled, its shared cooldown expired, and dispatch/watchdog/cache/projection-repair/retention schedules remain active. The city campaign remains complete. The public Trends cache still references run 17935 (02:00), published at 02:19 UTC, with zero missing projection batches for that completed run. The latest two operational request/lookup budgets are zero because no jobs were claimed.

The 07:10 retention cron execution failed after about 12 seconds; its 07:00 predecessor succeeded. A succeeded dispatch cron alone does not verify downstream object deletion. Current archive capacity and retention eligibility are not revalidated through the slow Storage scan. No recovery is claimed. No additional repair attempts, production mutations, or ownership changes were made.

A targeted read of retention cron error details subsequently returned HTTP 524. The failed execution is confirmed, but its precise error remains unverified.

## 08:12 heartbeat follow-up

The 07:00 sweep missed all 72 batches with zero attempts, bringing this incident to five incomplete hours (03:00–07:00). Operational reconciliation found 158 expected slots: 148 complete, nine partial (four previously known plus five incident slots), zero expired absent rows, zero expired running rows, and the current 08:00 running slot. The current slot had 72 queued jobs with zero attempts; its deadline is 09:00 UTC and it is not counted as missed.

Dispatch continues with collection enabled and continuous. The last provider request remains 03:04 UTC; the shared cooldown is expired. All three fixed routes still return the database-claim HTTP 503 failure with matching regions. All national schedules remain active. Trends still references the complete 02:00 run, published at 02:19, and that run has zero missing projection batches. The latest two runs consumed zero request/lookup budget because no jobs were claimed.

The retention error text is now available: both the 07:50 and 08:10 cron executions failed with `job startup timeout`; the 08:00 execution succeeded. This shows another database execution problem beyond the measured slow capacity scan, without establishing a shared root cause. Successful cron dispatch does not establish downstream retention completion. Current archive usage and retention eligibility remain unverified.

A read-only role configuration query confirmed `service_role` has no role-level settings and `authenticator` has eight-second statement and lock timeouts. A preceding combined settings query failed with HTTP 544 while creating its temporary login role. These role settings alone do not establish the effective failing request timeout or its underlying PostgreSQL exception. Supabase documents function-scoped statement timeouts (https://supabase.com/docs/guides/database/postgres/timeouts), but no production timeout was changed: increasing one deadline is not a demonstrated repair for the concurrent login and cron startup failures. The exact Storage accounting and capacity stop remain intact.

No additional repair attempts, provider requests, production mutations, or research-data changes were made. The incident still has one rejected index repair attempt. No resumed scheduled collection or immutable archive read-back is claimed. Owner/Supabase investigation of the managed database/Storage performance remains necessary unless a separately validated scoped repair becomes available.

## 09:15 heartbeat follow-up

The 08:00 sweep missed all 72 batches with zero attempts. This incident now has six incomplete hourly sweeps (03:00–08:00). Reconciliation found 159 operational slots: 148 complete, ten partial (four previously known plus six incident slots), zero expired absent rows, zero expired running rows, and the current 09:00 running slot. That current slot has 72 queued jobs and is allowed until 10:00 UTC. Both latest runs consumed zero request/lookup budget.

Collection remains enabled and continuous; dispatch advances on all three fixed regional routes. Saved responses still show database-claim HTTP 503 failures with correct regions. The last provider request remains 03:04 UTC, the shared cooldown expired at 02:16, and the latest saved events contain no newer provider denial. All five national schedules remain active. Trends still references the complete 02:00 run published at 02:19, whose projection backlog is zero.

Retention cron executions at 09:00 and 09:10 both failed with `job startup timeout`, following a successful 08:50 dispatch. A fresh bounded read-only capacity query failed with SQLSTATE 57014 inside `fuel_national_archive_bytes()` after its ten-second diagnostic statement timeout. Current archive usage and retention eligibility therefore remain unverified. No production timeout or other setting changed, no additional repair was attempted, and no provider replay or research data mutation occurred. The rejected index request remains the sole repair attempt. No collection recovery or immutable archive read-back is claimed; the managed database/Storage performance issue remains unresolved.
