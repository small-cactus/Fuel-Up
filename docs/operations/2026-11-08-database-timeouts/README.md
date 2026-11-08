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
