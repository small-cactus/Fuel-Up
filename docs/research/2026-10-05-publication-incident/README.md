# October 5 database connectivity and national publication recovery

## Incident

At 00:50 UTC, the midnight nationwide sweep (run 5116) had completed all 72 batches and 141,660 catalog IDs. All 99 expected hours, including absent rows, comprised 84 complete, ten historical partial and five historical unstarted hours. There were no new collection gaps. City collection had 2,418 successes, 54 unchanged misses, 48,360 observations and no overdue unfinished jobs. All regional mismatches were zero.

Six batches were missing their derived app publication. The leaderboard still served run 5056 from 23:23 UTC. Automatic archive replay repeatedly returned PROJECTION_PUBLISH_FAILED, exhausting six replay attempts for job 366544. Its original failure evidence and counters are preserved.

The database simultaneously failed to start scheduled jobs: 18 national dispatch executions failed in the preceding two hours with `job startup timeout`. A fresh Supabase dashboard showed **Unhealthy**, “Database not usable”, and TCP CONNECT_TIMEOUT after 5002 ms. A diagnostic verified-archive replay of job 366544 timed out after 45 seconds. No SQL-specific error response was received, so the underlying infrastructure cause remains unconfirmed.

Dashboard resource observations before restart: CPU 17%, disk 9%, RAM 54%; the memory chart showed 531.71 MB swap and 8.89 MB free at 00:40 UTC. This suggests memory pressure but does not establish it as the root cause. After refresh, several database I/O and connection metric charts remained unavailable. Disk I/O budget could not be independently verified. Archive accounting was 334,760,764 of the unchanged 900,000,000-byte budget, with total Storage 339,035,712 bytes and database size 367,316,115 bytes. No capacity stop or newer provider denial was present; the shared cooldown had expired at 23:17 UTC.

## Recovery attempt 1

Restarted only project vjindchxfebaltbslqwc through the authenticated Supabase dashboard around 00:55 UTC, using the existing proactive recovery authorization. The UI confirmed Restarting, then Healthy by 00:57 UTC. A query crossing the restart returned PostgreSQL 57P01 (terminating connection due to administrator command), as expected during restart.

Automatic scheduled replay recovered job 366560 at 00:57:07. Five protected manual publications replayed the remaining verified immutable archives at 00:57:28–00:57:55. Each returned HTTP 200 and 2,000 stations, taking 2.8–5.4 seconds after restart. Every replay verified compressed length, SHA-256, full station identity/order, schema, timestamps, priced count and assigned regional provenance before publishing unchanged archive content. The existing serving function fences updates by observation timestamp. No provider collection was manually invoked, no raw prices were overwritten, and research deadlines, budgets, routing and production ranking policy remained unchanged.

All six missing publications were present by 00:58. The regular Cron cache publisher refreshed all ten app scopes to run 5116 at 00:58:00. Historical replay failure rows remain untouched; their lack of a completed_at marker does not indicate a missing publication now that the hash-matched trend batch exists. No executable code or deployment change was needed.

## Verification

- Fourteen focused archive-replay and regional-routing unit tests passed.
- Six provider-free live regional health checks passed, including rejection of wrong execution regions.
- auditHour.mjs verified all 72 immutable archives of run 5116, totaling 3,540,114 compressed bytes and 141,660 distinct fixed-catalog IDs: Virginia 117,700, Northern California 17,747, Oregon 6,213.
- 86,951 IDs had reported prices; 54,709 did not. These are provider observations, not verified pump truth. Texas/DC geographic assumptions and the Texas one-ID provider-aggregate discrepancy are unchanged.
- The full archive audit verifies the completed midnight sweep, which was collected before the restart. Subsequent scheduled collection is checked separately below.

Reserved final evaluation data was not used for modeling. The phone app was not opened.

## Scheduled recovery at 01:00 UTC

All main and watchdog Cron executions succeeded after restart; the latest recorded startup failure was 00:54 UTC. The ordinary national scheduler started run 5156 for the 01:00 slot. By 01:00:29 it had archived two batches (4,000 IDs), demonstrating provider collection resumed without a manual collection invocation. This hour remains in progress before its 02:00 deadline. There are now 100 expected slots: 84 complete, ten historical partial, five historical unstarted, and this current running slot. City dispatch is current with zero due jobs; its next scheduled city observations begin at 01:19, so its unchanged success count is expected.

The public app endpoint returned HTTP 200, five quotes, current scan 5116 and no history error for all ten fuel/E85 scopes at 00:59. The database query found no other active query at its snapshot. These observations establish recovery, not long-term stability or an infrastructure root cause.

At 01:01:24 the new sweep had progressed to six batches and 10,213 IDs. The first regional audit selection was too early to include Virginia, so it correctly refused to claim three-region coverage. The existing scheduler selected Oregon, then Northern California, then Virginia according to its normal dispatch order. No schedule or routing change was made. At 01:02:37, the repeated audit verified one newly archived batch from each of the three assigned regions, all observed after restart. This confirms resumed scheduled collection and immutable read-back in every region; it is not a claim that the still-running 01:00 hour is complete.

Evidence JSON parsing and whitespace checks passed. Recovery used one project restart and one post-restart replay pass; the earlier diagnostic replay timeout is retained. The original provider and replay errors remain preserved. Ongoing monitoring should distinguish those historical errors from new missing hash-matched publications or new expired collection slots.
