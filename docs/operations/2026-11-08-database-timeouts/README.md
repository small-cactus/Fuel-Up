# November 8 recurring database timeouts

The 07:39 UTC heartbeat encountered HTTP 544 connection timeouts while initializing the protected database login role. The standard status read and supplemental checks both failed. Two protected direct REST reads timed out after 12 seconds each. These are fresh symptoms following verified healthy sweeps through 06:00 UTC.

Intermittent successful protected reads showed run 52715 for 07:00 still running, with 65 successful batches (65 attempts), seven queued, and the last provider request at 07:13:31 UTC. Scheduled east workers returned HTTP 503 `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED` at 07:28, 07:33 and 07:36 UTC. Expected and actual routing both remained us-east-1. Continuous collection remains enabled and the prior cooldown expired at 06:14:26 UTC; its historical halt reason is not evidence of an active denial or pause.

The current hour has until 08:00 UTC and is not yet an expired gap. The last verified complete cache remains run 52655 (06:00), published at 06:20 UTC in ten scopes. The last comprehensive successful check at 06:35 had no new gaps and no projection backlog, with the three previously reported partial hours unchanged. This heartbeat could not freshly verify the full gap count, archive capacity, retention or projection backlog.

No repair was attempted (zero attempts). Symptoms resemble the November 7 incident, but no common root cause has been established. No provider request, collection replay, restart, re-enable, schema change, routing change, billing change, raw-price write or research modification was performed by the monitor. The saved evidence contains no credentials.

Next check: confirm whether the 07:00 hour completed before its deadline, count any new partial/absent expired slots, investigate database resource/server logs when accessible, and verify scheduled recovery plus immutable regional archive read-back before reporting recovery. Do not bypass cooldowns, denials, pauses or archive capacity stops.
