# October 4 database outage and recovery

At 10:44 UTC, the active 10:00 national sweep (run 4301) had stopped at 26/72 archived batches, covering 49,960 fixed-catalog IDs. Its last provider request was at 10:09:07. The hour was still before its 11:00 deadline and was not counted as an expired gap. All 84 previous expected slots were accounted for: 70 complete, nine historical partial and five historical unstarted. City collection had 2,082 successes, 54 unchanged misses and no expired backlog.

## Evidence

Both collectors, fixed regional workers, main schedules and watchdogs remained enabled. The shared provider cooldown had expired at 07:05:28. No new access denial or capacity stop was present. Database size was 362,318,995 bytes; total Storage was 287,371,012 bytes; accounted archives were 283,096,064 against the unchanged 900,000,000-byte budget.

Cron began intermittently failing with `job startup timeout`; 18 national dispatch executions failed in the last hour. The diagnostic database query then failed before execution with HTTP 544: `Failed to create login role: Connection terminated due to connection timeout`. A refreshed dashboard reported **Unhealthy**. This establishes database connectivity failure; the underlying infrastructure cause is unconfirmed. The original hour and errors remain preserved.

## Recovery attempt 1

Using the existing proactive repair authorization, restarted only project `vjindchxfebaltbslqwc` through its logged-in Supabase settings at approximately 10:48 UTC. The UI confirmed **Restarting**. This follows the successful October 3 recovery procedure. No provider collection was manually invoked; no identities, regional routing, deadlines, budgets, raw observations, job attempt counts, or production ranking were changed.

All six provider-free regional checks passed, including rejection of incorrect execution regions. The first database check during restart still returned HTTP 544. A restart request and reachable workers do not establish recovery; scheduled collection and immutable archive verification are required below.

## Recovery verified at 10:53–10:54 UTC

The dashboard returned to Healthy and protected database queries succeeded. Scheduled national collection resumed, reaching 30/72 batches and 57,960 archived IDs at 10:54. The latest main Cron executions succeeded. City dispatch resumed with no due or expired backlog; its 24 current-hour jobs had already succeeded before the restart, so the unchanged success count is expected.

`regional-readback.json` verifies one immutable archive from each fixed region, including a new Virginia provider response observed at 10:53:30 after the restart. SHA-256, exact station IDs, timestamps, schema and regional provenance passed. California and Oregon had completed before the outage; their read-back samples are earlier in this same hour. This is a three-batch audit, not full-hour completeness or pump-truth verification.

A worker response during service startup at 10:53:02 returned a database failure; later successful archives establish progress after it. The post-restart database snapshot showed no waiting locks, no queued HTTP requests and no other active queries. These checks establish resumed collection, not the underlying infrastructure cause or long-term stability.

All 85 expected national slots, including absent run rows, remain accounted for: 70 complete, nine historical partial, five historical unstarted and the current running hour. At this checkpoint the original 11:00 deadline had not passed. The interrupted sweep is at risk of expiring partially; no deadline was extended. No new city gap was observed and all regional mismatches remain zero.

Validation: nine regional unit checks, six provider-free live health/routing checks, protected database/Cron health queries, three-region immutable archive read-back, evidence JSON parsing and whitespace checks. No application code or deployment was needed. One recovery attempt was used. Texas/DC geographic assumptions and the Texas one-ID aggregate discrepancy remain unchanged. Reserved final evaluation data was not inspected.

## 10:57 UTC continuation

A second scheduled invocation after the earlier worker lease expired advanced the sweep to 36/72 batches, or 69,960 IDs, confirming continued progress beyond the initial restart. The last dispatch is 10:57:00. The hour is still incomplete and before its deadline. No second restart or code repair was needed. The next monitor must report any newly expired gap and verify continued scheduled collection.

## 11:45 UTC follow-up: one confirmed partial hour, subsequent sweep complete

Run 4301 expired at its original 11:00 deadline with 50/72 batches and 97,960 observed fixed-catalog IDs. The outage therefore left 22 missing batches (43,700 IDs) in the 10:00 hour. These missing historical observations are preserved, without backfilling or extending the campaign.

The next scheduled sweep, run 4336 at 11:00, completed at 11:17:24 with all 72 batches and 141,660 IDs: 91,397 had reported prices and 50,263 did not. City collection reached 2,106 successful city-hours and 42,120 observations, with 54 unchanged historical misses and zero due/expired backlog. All 86 expected national slots, including absent run rows, now comprise 71 complete, ten partial and five historical unstarted hours. No regional mismatch was found.

All main/watchdog schedules remain enabled and their latest executions succeeded; the last recorded startup failures were during the restart at 10:49. Transient HTTP 503 and GraphQL jobs 310440 and 310408 both succeeded on attempt two with their original errors retained. Shared cooldown expired at 11:10:35. Database size is 360,705,171 bytes, accounted archives 287,987,718/900,000,000 bytes and total object storage 292,262,666 bytes. No further repair or provider collection was initiated.

The first full-hour read-back download through the CLI management gateway returned HTTP 502. This is a read-back transport failure, not proof of missing or corrupt archives. Retried via authenticated Storage using bounded backoff, preserved local files and per-file size/hash validation; credentials remain in process memory. The canonical audit runs against that saved manifest and immutable local files.

At 11:48 UTC, `auditHour.mjs` verified **all 72 immutable archives** for run 4336: SHA-256, exact IDs, schema, timestamps and regional provenance. The full read-back accounts for 3,664,679 bytes and all 141,660 IDs across Virginia (117,700), Northern California (17,747) and Oregon (6,213). This confirms sustained scheduled recovery for the subsequent full hour. It does not repair the prior 22-batch gap or verify pump truth. Follow-up evidence JSON parses and whitespace checks pass; no executable project code changed.
