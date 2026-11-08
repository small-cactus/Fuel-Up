# November 8 recurring database timeouts

The 07:39 UTC heartbeat encountered HTTP 544 connection timeouts while initializing the protected database login role. The standard status read and supplemental checks both failed. Two protected direct REST reads timed out after 12 seconds each. These are fresh symptoms following verified healthy sweeps through 06:00 UTC.

Intermittent successful protected reads showed run 52715 for 07:00 still running, with 65 successful batches (65 attempts), seven queued, and the last provider request at 07:13:31 UTC. Scheduled east workers returned HTTP 503 `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED` at 07:28, 07:33 and 07:36 UTC. Expected and actual routing both remained us-east-1. Continuous collection remains enabled and the prior cooldown expired at 06:14:26 UTC; its historical halt reason is not evidence of an active denial or pause.

The current hour has until 08:00 UTC and is not yet an expired gap. The last verified complete cache remains run 52655 (06:00), published at 06:20 UTC in ten scopes. The last comprehensive successful check at 06:35 had no new gaps and no projection backlog, with the three previously reported partial hours unchanged. This heartbeat could not freshly verify the full gap count, archive capacity, retention or projection backlog.

No repair was attempted (zero attempts). Symptoms resemble the November 7 incident, but no common root cause has been established. No provider request, collection replay, restart, re-enable, schema change, routing change, billing change, raw-price write or research modification was performed by the monitor. The saved evidence contains no credentials.

Next check: confirm whether the 07:00 hour completed before its deadline, count any new partial/absent expired slots, investigate database resource/server logs when accessible, and verify scheduled recovery plus immutable regional archive read-back before reporting recovery. Do not bypass cooldowns, denials, pauses or archive capacity stops.

## 08:37 UTC follow-up: confirmed missed batches

Run 52715 (07:00) closed partial at 08:01:01 UTC: 65 successful batches and seven missed, with 65 total attempts. Run 52746 (08:00) exists with all 72 jobs queued and zero attempts; its deadline is 09:00 UTC. The retained eight-day slot check now reports four partial hours, zero expired absent slots and zero expired running slots. The last published cache remains the complete 06:00 run 52655, published at 06:20 in all ten scopes.

Saved HTTP results show claim failures in all three fixed regions, with matching expected/actual routing. The retention worker also returned HTTP 503 `NATIONAL_RETENTION_FAILED` at 08:30. Dispatch, watchdog and retention schedules remain active; there is no missing main schedule to restore.

The standard status query failed with HTTP 524; a brief query failed during login-role creation with HTTP 544. Intermittent small reads succeeded. A connection/activity snapshot showed 24 total pg_stat_activity entries against max_connections=60, no blocking PIDs, and only the diagnostic and monitor queries active. This does not establish a connection-limit or lock explanation and does not prove resource health over time. No safe targeted repair is supported by this evidence. Full archive capacity and projection checks remain unverified this heartbeat.

Zero repair attempts and zero monitor-triggered provider requests. No restart, replay, re-enable or configuration/data change was performed. `followup-0837.json` preserves sanitized evidence. Continue investigation using saved worker/database evidence and resource/server logs when accessible; verify scheduled recovery and immutable archives before closing the incident.

## 10:45 UTC follow-up: additional incomplete hours

A successful minimal run-table read confirms that run 52746 (08:00) closed partial at 09:01:04 UTC and run 52771 (09:00) closed partial at 10:01:03 UTC. Together with 07:00, this incident now has three consecutive incomplete hours. Run 52800 (10:00) exists and was running; it has until 11:00 UTC. Latest job counts could not be obtained, so this follow-up does not assert exact missed-batch counts for 08:00 or 09:00, nor a complete absent-slot total.

The full status attempt timed out with SQLSTATE 57014 inside `fuel_national_retention_candidates`. Brief, job/cache/slot, and query-timing diagnostic requests failed during login-role setup with HTTP 544 connection timeouts. A minimal job/config/cache retry also failed at connection setup. The timing query did not execute successfully, so no bottleneck or root cause is inferred from it. Full current cache, capacity, retention, budgets, cooldown and projection verification remains blocked.

No repair was attempted (zero attempts), and the monitor triggered no provider collection. No restart, re-enable, replay, configuration, billing or raw-data change was made. `followup-1045.json` preserves the successful run statuses and failure summary. Continue checking for scheduled recovery and use immutable archive read-back when recovery is verified.

## Active repair after the user's escalation

At 16:06 UTC, small protected queries became usable. They confirmed nine partial
hours, 07:00 through 15:00: seven missed batches at 07:00 and 72 in each of the
following eight hours, totaling 583 missed batches. The 16:00 scheduled run had
already resumed before the repair. This initial recovery was automatic and is not
attributed to our changes.

Independent host metrics exposed 431,308,800 bytes of physical RAM, about 459 MiB
of occupied swap, and a trailing 15-minute load average of 12.24. Connection
snapshots showed no blockers and approximately 24 connections against a limit of
60. These measurements establish resource pressure, but do not prove the precise
initiating cause of every timeout or exhausted provider disk credits.

Index inspection found a concrete source of avoidable database work:

| Index | Before | After first verification |
| --- | ---: | ---: |
| Retention reference | 129,376,256 bytes; 6.61% leaf density | 2,039,808 bytes |
| Redundant job reference | 28,868,608 bytes | Removed; covered by replacement |
| Price ordering | 56,213,504 bytes; 32.98% leaf density | 22,790,144 bytes |
| Price lookup primary key | 29,122,560 bytes; 44.75% leaf density | 14,376,960 bytes |

The former retention index used INCLUDE, which prevents PostgreSQL B-tree
deduplication. The replacement uses the same four values as keys, allowing shared
batch-reference values to use posting lists. It retains job-ID lookup and covering
read behavior. A production EXPLAIN confirmed an index-only scan using the new
index with zero heap fetches. See the
[PostgreSQL B-tree documentation](https://www.postgresql.org/docs/17/btree.html).

One coherent production repair deployed migration
`20261108161500_compact_retention_reference_index`: concurrent creation of the
replacement, removal of the two superseded non-constraint indexes, and concurrent
rebuilds of the two price indexes. All indexes are valid/ready, with no invalid
indexes left behind. The primary key and foreign keys remain intact. The migration
is recorded remotely. The temporary pgstattuple diagnostic extension was removed.
No database restart, billing change, provider replay, re-enable or raw-price rewrite
was used.

The existing retention function drained six overdue operational metadata hours
in three bounded transactions, detaching 296 receipt-covered old references. A
fourth transaction was empty. Raw catch-up uses the existing authenticated
retention dispatcher, only after the preceding response succeeds; its existing
48-hour boundary, original-research protections, cache pin and active-lease checks
remain unchanged. Scheduled collection stays active throughout.

The monitor now returns structured partial diagnostics after a full-status
failure: independent host metrics, recent runs and batch counts, absent-slot
counts, cache age, connection waits and schedules. Failures remain a nonzero exit
and `partial: true`, so fallback evidence cannot masquerade as a healthy full
check. Metrics credentials remain in memory and are sent only to this project's
Supabase endpoint; arbitrary exporter labels and raw error strings are discarded.
Healthy status includes index sizes for recurrence detection. The standing
automation was updated to continue diagnosis and scoped repair rather than repeat
identical failed polls.

Validation: 37 Node tests passed, plus the isolated PostgreSQL integration suite
with this migration. The suite checks exact serving-result equality, publication,
freshness, stale replay, E85, geographic queries, retention boundaries, covered and
uncovered references, the 100-reference write cap, permissions and collection
budgets. `repair-evidence.json` records the measured diagnosis and deployment.
Final scheduled-sweep, cache and immutable-archive verification follows below.

## Verified recovery at 16:22 UTC

- Scheduled run 52886 completed at 16:18:47 UTC: 72/72 batches, all 141,660 fixed
  catalog stations, correct routing across all three regions. It used 73 requests
  and 143,660 lookups, within the unchanged 92 / 161,660 limits. A transient 502
  cooldown expired naturally; it was not cleared or overridden.
- Five archived batches needed projection replay after collection. Two completed
  through scheduled recovery and three through the same guarded dispatcher during
  catch-up. Each finished on its first repair attempt, without provider requests.
  The observed four-batch backlog at 16:20 drained to zero at 16:21:10.
- The scheduled publisher refreshed all ten Trends scopes to run 52886 at
  16:22:00. The public API then matched stored complete-sweep history in all ten
  fuel/E85 combinations, including the new 16:00 point. No incomplete sweep was
  published.
- Scheduled retention returned HTTP 200 at 16:20, removing the final 48 eligible
  operational objects. No eligible raw objects or overdue metadata remain.
  Accounted archive usage is 714,207,431 of 900,000,000 bytes. All six national and
  local-history schedules are active.
- One immutable archived batch per fixed region passed actual Storage read-back,
  SHA-256, byte size, exact ID, schema, time-window and provenance checks. The audit
  selected a complete run; database manifests separately establish 72/72 coverage.
  This is a three-object integrity sample, not an audit of all 72 objects.
- All 11,121 original-research objects in the checked inventory and all 72 objects
  in the previous published cache retain identical name/metadata fingerprints
  across catch-up. The city campaign remains complete.
- The cached-price API passed 24 location/radius checks across six cities. Local
  Trends passed first-visit checks in three areas. No phone app was opened.
- The retained eight-day window has 180 complete hours and 12 historical partial
  hours (nine from this incident, three previously reported), with zero absent or
  expired-running slots. The 583 missed batches were not recreated or disguised.

`recovery.json`, `archive-readback.json`, `serving-api.json` and
`local-trends-api.json` preserve these checks. Resource pressure and index bloat
were measured and the index defect was repaired; the initial automatic recovery
predated the repair, and a single recovered sweep cannot prove that every future
infrastructure failure has been eliminated. Continue active monitoring and repair
using the new independent diagnostics rather than treating another timeout as a
reason to stop investigating.
