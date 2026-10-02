# October 2, 10:00 UTC database incident

The 10:37 UTC heartbeat found national run 1614 still running with 61/72 batches archived (119,960 of 141,660 IDs). Job 114444, ordinal 48, exhausted its three claims after metadata database failures; ten other batches had not started. The hour's deadline remains 11:00 UTC. This is a stalled current hour, not an expired missing hour.

The preceding 27 national hours completed; four historical partial run hours and five unstarted October 1 hours remain preserved. City collection at the first snapshot had 947 successes, 32 historical misses, and no due/running queue. Database size was 320,728,211 bytes; object storage was 120,540,363 bytes, safely below the existing limits. All workers and schedules were enabled and regional provenance was correct.

## Evidence and diagnosis

- The two 10:00 provider HTTP 503 responses included Retry-After: 5. The final shared cooldown expired at 10:08:11 UTC. No unresolved access or rate denial was observed.
- National events 97 and 98 record `DATABASE_FUEL_STATION_METADATA_NEEDED_FAILED` at 10:19:47 and 10:31:27 for job 114444. Those pre-provider failures have no provider response evidence. The original event rows remain intact.
- A direct read of `fuel_station_metadata_needed` for ordinal 48 failed with PostgreSQL SQLSTATE 57014, explicitly naming that SQL function in the timeout context. A repeated check with a five-second statement timeout also failed. Alternative read-only indexed and sequential lookup probes timed out as well; no query rewrite was deployed without evidence that it helps.
- Several cron jobs failed at 10:32 and 10:35 with `job startup timeout`. Management API queries intermittently failed with HTTP 544, including login-role creation. Protected REST health reads and the metrics endpoint also exceeded 15 seconds.
- An autovacuum/analyze of `fuel_station_latest` was active for more than 25 minutes. Its successor, PID 396198, was still scanning the heap at 10:47:36: 6,582/21,340 blocks, 1,994 dead item IDs. Heap size was 174,817,280 bytes; primary-key index size 6,389,760 bytes. Other snapshots showed no sustained application query or lock wait. This identifies maintenance activity during the incident but does not prove it caused the problem.
- Supabase's public status page also lists an ongoing Eastern US latency incident. That alone does not explain the directly reproduced PostgreSQL timeout; the underlying database/resource cause remains unconfirmed.

## Limited recovery attempt and blocker

One guarded recovery attempt targeted only PID 396198, requiring its exact non-wraparound autovacuum query, backend type, and age greater than five minutes. `pg_cancel_backend` was rejected with SQLSTATE 42501: only a SUPERUSER can cancel this platform-owned backend. No maintenance job was cancelled, no privilege override was attempted, and automatic maintenance remains enabled.

No provider calls were initiated by this monitor. No job attempts were reset, no budgets/cooldowns were changed, no raw prices were overwritten, and neither research window was extended. No application or collector code changed. Scheduled collection remains enabled so it can resume if the database recovers.

A project-owner database restart through the Supabase dashboard, or intervention by Supabase support, may be necessary if the database remains unresponsive. A restart has not been performed. After recovery, verify scheduled progress and read back immutable archives before claiming recovery. Preserve any resulting historical gap rather than backfilling it with later prices.

## Final read-only checkpoint, 10:49 UTC

`live-audit.json` confirms national progress remains 61/72, with additional metadata failures affecting ordinals 49 and 50. There are 27 complete hours out of 37 expected slots: four historical partial rows, five historical unstarted hours, and this current running hour. City checks progressed to 952 successes with 32 unchanged historical misses and zero expired pending jobs. Regional mismatches remain zero. The last hour included 16 national-dispatch and 18 city-dispatch cron failures, interspersed with successful runs. This is degraded service, not a disabled collector or an archive-capacity stop.

Verification for this evidence-only checkpoint: all saved JSON files parse; no application tests were necessary because no executable code changed. Recovery and archive read-back are not verified.
