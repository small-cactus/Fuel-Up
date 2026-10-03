# October 3 database outage and recovery

At the 04:42 UTC heartbeat, nationwide run 2549 (04:00) had 55/72 archived batches and was still before its 05:00 deadline. The previous 03:00 run was complete. Coverage counted all 55 expected hours, including absent rows: 41 complete, eight historical partial hours, five historical unstarted hours, and the current running hour. City history had 54 misses, unchanged from the October 2 connect-reset incident, and zero expired pending jobs. There were no regional routing mismatches.

## Evidence and diagnosis

- Both collectors were enabled, all main/watchdog schedules were present, and shared cooldown expired at 04:27:39 UTC. The recorded provider 503 was followed by retry handling; it did not disable collection.
- Numerous Cron executions failed intermittently, interspersed with successful dispatch calls. National progress stopped while unattempted jobs remained queued. Exact Cron error text could not initially be fetched because database login-role creation itself failed twice with HTTP 544 and connection timeout.
- Refreshing the logged-in Supabase dashboard showed **Unhealthy**, **Database not usable**, and `Connection failed at the TCP layer (CONNECT_TIMEOUT) after 5002ms: timeout expired.` This establishes a database-connectivity outage, not a provider access denial. Its underlying infrastructure cause remains unconfirmed.
- All six provider-free regional health/routing checks passed. The database was 347,835,539 bytes; object storage 178,118,499 bytes; accounted national archives 173,843,551 against the unchanged 900,000,000-byte budget. No capacity stop was present.

## Scoped recovery, attempt 1

Used the existing proactive recovery authorization to restart this project through its already logged-in Supabase dashboard at approximately 04:46:45 UTC. The same recovery restored database connectivity during the October 2 incident. The dashboard confirmed **Restarting**. No application code, schedules, collector pause state, budgets, catalog, provider identity/routing, or collection deadlines were changed. No provider collection was manually invoked.

Original data/error evidence is retained. The subsequent CLI checks during restart returned a connection-setup/IPv6 availability error; these do not establish recovery or an additional provider failure. No second restart was submitted while the first was in progress.

## Recovery verified at 04:52–04:53 UTC

The dashboard returned to Healthy, and protected database health queries succeeded. The recovered query also obtained the original Cron failure text: `job startup timeout`. Both collectors resumed through their existing Cron schedules; no manual dispatch was used. Fresh Virginia archives completed after 04:52 UTC, advancing run 2549 from 55 to 61/72 batches at the latest status capture, with zero missed batches. Its 05:00 deadline had not passed. City collection reached 1,362 successes with the same 54 historical misses, no due backlog, and zero expired pending jobs.

`regional-readback.json` verifies a successful immutable batch from each fixed region, including a new post-restart Virginia observation. The California and Oregon samples are earlier successful observations from this hour; those regions had already completed before the outage. SHA-256, exact station IDs, price schema, timestamps, and regional provenance passed. This is a three-batch audit, not full-hour completeness or pump truth. No wrong-region jobs were found.

All expected-slot counts remain unchanged: 41 complete, eight partial, five expired unstarted, one current running. No new expired gap is claimed. Accounted archives reached 174,150,201 bytes against the same 900,000,000-byte budget. Main schedules and watchdogs remain active. Original provider 503/error history is retained. Underlying infrastructure cause and long-term stability are not established by this recovery.

Validation: successful protected health queries and post-restart Cron executions; all six provider-free regional health checks; immutable archive read-back; evidence JSON parsing and whitespace checks. No executable code changed or deployment was necessary. One recovery attempt was used.

Texas/DC geographic coverage assumptions and Texas's one-ID aggregate discrepancy remain unchanged. Archived observations and missing prices do not establish verified pump truth. Reserved final evaluation days remain untouched.

## 05:42 UTC follow-up: sustained recovery, no new gaps

The affected 04:00 sweep completed at 04:55:03 UTC with all 72 batches, before its original deadline. `full-recovery-hour-readback.json` verifies every immutable archive using the committed `auditHour.mjs`: hashes, exact fixed-inventory IDs, timestamps, schema, and regional provenance. The subsequent 05:00 sweep also completed, at 05:14:37, with all 141,660 IDs and 95,104 stations with reported prices (46,556 without prices).

All 56 expected nationwide slots, including hours without run rows, are accounted for: 43 complete, eight historical partial, and five historical expired unstarted hours. The current 05:00 hour is already complete. City successes reached 1,386; historical misses remain 54, with zero due backlog or expired pending jobs. No new gap resulted from this outage.

Both collectors and their main/watchdog schedules remain active. Every scheduled execution in the last ten minutes succeeded. The shared cooldown is expired, no newer provider denial exists, all six regional health/routing checks passed, and regional mismatches remain zero. Accounted archives are 178,451,380 of 900,000,000 bytes; database size is 348,564,627 bytes and total object storage 182,726,328 bytes. Optional serving projection timeouts and the older Trends cache remain separately visible; raw collection is complete. No additional repair or provider request was initiated by this follow-up.
