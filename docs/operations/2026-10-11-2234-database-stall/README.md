# October 11 22:34 UTC database service outage

Initial protected status and supplemental health queries failed with HTTP 544: `Failed to create login role: Connection terminated due to connection timeout`. Home and Trends both exceeded 20 seconds, twice. These first query failures were observed in command output; the original stdout files were empty.

The dashboard reported Unhealthy, with PostgREST and Auth unhealthy, while its database health badge was healthy. Database logs independently show repeated statement timeouts, slow monitoring queries (11.3 and 15.2 seconds), SSL EOF errors, and transient transaction lock waits. Some cron dispatch calls still completed. This is degraded database/service operation, not proof that every database process stopped.

Supabase displayed a warning that the project's disk I/O budget was about to deplete, with throughput returning to a 5 MB/s baseline when exhausted. CPU was 13%, disk 10%, RAM 64%, and 9/60 connections. This new capacity warning is relevant evidence but does not establish the root cause by itself.

## Repair attempt 1

All 23 regional routing, retention, and GraphQL-error tests passed. A single project restart was initiated at approximately 22:38 UTC under standing repair authorization. No billing, resource limits, collector configuration, routing, identity, retention policy, or raw observations were changed. No manual provider collection was triggered. The restart is recovery of unhealthy services, not a change to the disk I/O allowance.

Recovery verification is pending. The current 22:00 sweep has until 23:00 UTC and must not yet be classified as missed. The preceding 21:00 sweep was complete at the last check.

The delayed status recheck eventually returned a pre-restart snapshot at approximately 22:37 UTC: run 14849 had 20/72 successful batches, 38,213 observed IDs, and last provider claim at 22:05:43. Collection remained enabled, cooldown expired at 22:04:51, all five cron schedules were active, and archive accounting was 743,819,932/900,000,000 bytes. No new expired hour gap was present. Trends correctly remained on complete 21:00 run 14789. This snapshot is not evidence of restart recovery.

## Recovery observations

PostgreSQL restarted at 22:42:35.341293 UTC. Supabase reported every service healthy; Home and Trends returned HTTP 200 in 2,006 and 1,282 ms. The first recovery health query showed 16 database connections, no waiting locks, and no post-restart failed cron executions. Existing worker claim failures and retention failures remain recorded.

An advancing 60.661-second resource sample measured 314,953,728 bytes of swap-in, 284,889,088 bytes of swap-out (explicit 4 KiB page conversion), 42,910 major faults, and 23.47% CPU I/O wait; no new OOM kill occurred. This establishes continuing resource pressure after restart. It does not conclusively identify the original trigger. No paid upgrade or resource-limit change was made.

An authorized maintenance-only retention dispatch returned HTTP 200 at 22:43:44, zero objects removed, zero metadata hours removed, and zero provider requests. This verifies retention execution after restart; the cron schedule remains unchanged. The first three-region immutable read-back passed but all three samples preceded restart, so it alone does not prove resumed collection.

## Resumed scheduled collection

By 22:45 UTC, the existing scheduler had advanced run 14849 to 22/72 successful batches and 42,213 observed IDs (25,883 priced IDs), including new Virginia observations after restart. All three fixed regions retain zero wrong-region jobs. A subsequent upstream 502 used the normal 60-second cooldown; it was not cleared or bypassed. The 22:00 hour remains open until 23:00, with no new expired absent or running hours. Its completion is not claimed. One Northern California job (1067170) has exhausted three attempts following its preserved transient GraphQL and database diagnostic errors and lacks a successful manifest; attempt counts were not reset.

Trends still uses the complete 21:00 sweep across ten scopes with no missing projection batches or unresolved operational projection repairs. There are 96 complete operational hours, three previously reported partial hours, and one current hour. Both the archive budget and retention policies remain unchanged. The recurring resource pressure remains unresolved; this is a verified service recovery, not a permanent capacity fix. Exactly one restart was used and no deployment was needed.

The final sampled immutable read-back passed SHA-256, byte size, schema, exact catalog IDs, observation timing, price counts, and regional provenance for all three regions. The Virginia sample was observed after restart; both western samples preceded restart. This verifies a resumed scheduled archive alongside preserved western evidence, not whole-hour completeness or verified pump truth.
