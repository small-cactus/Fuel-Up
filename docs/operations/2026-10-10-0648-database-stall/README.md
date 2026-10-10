# October 10 06:48 UTC database degradation

The hourly monitor found the 06:00 sweep (run 12492) still at 46/72 archived batches, with the last provider request at 06:11:42 UTC. The 07:00 deadline had not elapsed. All prior operational hours remained complete except the already reported October 9 22:00 partial hour.

Protected database checks took over a minute. They returned 66 failed national cron executions since the previous recovery, repeated DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED errors, a WORKER_RESOURCE_LIMIT response, and retention failures. Last successful retention was 06:00, removing 72 eligible operational objects. The lightweight research health endpoint returned HTTP 200 in 5,838 ms; this does not establish healthy collector queries. Supabase's dashboard independently displayed Unhealthy. Exact underlying resource cause is not established by these observations.

Collection remains enabled; schedules and fixed routes remain intact, with no active shared cooldown. Archive accounting was 747,685,447 bytes against the unchanged 900,000,000-byte budget. Trends correctly retained the latest complete 05:00 run, with zero missing summaries for that completed sweep.

## Repair attempt 1

All 23 focused tests passed (regional routing, GraphQL errors, retention). One project restart was initiated at approximately 06:51 UTC under the standing repair authorization; the dashboard acknowledged Restarting. No code, configuration, paid compute, billing, collector enablement, retry budget, routing, identity, raw data, ranking or research retention policy was changed. No provider collection was manually triggered. Original error evidence is preserved.

Restart acknowledgment alone is not proof of recovery. Scheduled collection, serving and immutable archive verification remain pending below.

## Verified recovery and remaining gap

PostgreSQL restarted at 06:55:37.599 UTC; the dashboard reported Healthy. Scheduled collection resumed with no manual dispatch, advancing from 46 to 66 successful batches before the deadline. Read-back verified SHA-256, exact catalog IDs, schema and regional provenance for one successful archive per region. The East sample was collected at 06:56:35 after restart; West samples predated restart because their regional batches were already complete. This is a sampled archive audit, not whole-hour or pump-truth verification.

The 06:00 sweep finalized partial at 07:00: 66/72 batches and 129,960 observed IDs, leaving six missed batches / 11,700 IDs. Original evidence and the gap remain intact, without backfill. The 07:00 sweep started automatically and had two successful batches at 07:00:28, still legitimately in progress before its deadline. Across 61 expected slots, 58 were complete, two partial (including the already-reported October 9 22:00 gap), one current running, and none absent or expired-running.

At 07:00:28 Home returned HTTP 200 with 39 quotes in 1,396 ms; Trends returned HTTP 200 in 1,001 ms, correctly using the last complete 05:00 sweep. All ten scopes match that completed run, with zero missing batch summaries or unresolved operational projection repairs. No cron failures occurred after restart. HTTP errors retained in the last-20-minute window all predate restart.

Retention resumed on schedule at 07:00 with HTTP 200, removing/marking 72 eligible operational objects and issuing zero provider requests. No objects remained eligible at the check. Accounted archives were 745,185,014 bytes, below the unchanged 900,000,000-byte limit. All five schedules and fixed regional routes remain active and no shared cooldown is active.

One repair action was used. No code deployment was needed. Recovery is verified for database availability, app responses, resumed scheduled collection, sampled immutable archives, and retention; completion of the 07:00 sweep is not yet claimed. The recurring underlying database degradation remains unresolved, so this is operational recovery rather than a permanent fix.
