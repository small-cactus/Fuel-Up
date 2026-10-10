# October 10 06:48 UTC database degradation

The hourly monitor found the 06:00 sweep (run 12492) still at 46/72 archived batches, with the last provider request at 06:11:42 UTC. The 07:00 deadline had not elapsed. All prior operational hours remained complete except the already reported October 9 22:00 partial hour.

Protected database checks took over a minute. They returned 66 failed national cron executions since the previous recovery, repeated DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED errors, a WORKER_RESOURCE_LIMIT response, and retention failures. Last successful retention was 06:00, removing 72 eligible operational objects. The lightweight research health endpoint returned HTTP 200 in 5,838 ms; this does not establish healthy collector queries. Supabase's dashboard independently displayed Unhealthy. Exact underlying resource cause is not established by these observations.

Collection remains enabled; schedules and fixed routes remain intact, with no active shared cooldown. Archive accounting was 747,685,447 bytes against the unchanged 900,000,000-byte budget. Trends correctly retained the latest complete 05:00 run, with zero missing summaries for that completed sweep.

## Repair attempt 1

All 23 focused tests passed (regional routing, GraphQL errors, retention). One project restart was initiated at approximately 06:51 UTC under the standing repair authorization; the dashboard acknowledged Restarting. No code, configuration, paid compute, billing, collector enablement, retry budget, routing, identity, raw data, ranking or research retention policy was changed. No provider collection was manually triggered. Original error evidence is preserved.

Restart acknowledgment alone is not proof of recovery. Scheduled collection, serving and immutable archive verification remain pending below.
