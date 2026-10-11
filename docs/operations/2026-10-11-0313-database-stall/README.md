# October 11 03:13 UTC database outage

The hourly monitor's status and supplemental health queries both failed with HTTP 544: `Failed to create login role: Connection terminated due to connection timeout`. Supabase independently reported **Unhealthy**, **Database not usable**, and TCP `CONNECT_TIMEOUT` after 5003 ms. Dashboard metrics displayed CPU 46%, disk 10%, RAM 64%, and unavailable connections. These observations establish database unavailability, not its underlying resource cause.

Home and Trends requests both exceeded a 20-second timeout. Before this incident, the 02:12 UTC check showed the 01:00 sweep complete, the 02:00 sweep progressing at 55/72 batches, no new gaps, no active shared cooldown, and healthy retention. Current collector configuration cannot be inspected while login-role creation is unavailable. Nothing indicates a deliberate pause or provider access denial.

## Repair attempt 1

All 23 focused regional-routing, GraphQL-error, and retention tests passed. A single project restart was initiated through Supabase at approximately 03:14 UTC under standing repair authorization. No provider collection was manually triggered, and no code, budget, routing, identity, billing, retention policy, ranking, or raw observations were changed. Recovery remains to be verified; restart acknowledgment alone does not establish it.

## Verified recovery and preserved gap

PostgreSQL restarted at 03:18:40.13256 UTC. Supabase now reports Healthy, and Home/Trends returned HTTP 200 in 1,197/1,181 ms. Saved database evidence shows prior cron job startup timeouts and worker claim failures. One claim failure occurred at 03:19 during recovery; later scheduled collection succeeded. No cron execution failures were recorded after database restart.

The 02:00 sweep (13672) finalized partial at 03:01:03: 61/72 batches, 119,960 observed IDs, 76,185 priced IDs. The new gap is 11 batches / 21,700 inventory IDs. It remains preserved without backfill. There are now three operational partial hours including the two previously reported incidents, with no absent or expired-running slots.

The 03:00 sweep (13717) resumed through its existing schedules and reached 13/72 batches / 24,213 observed IDs at 03:22 UTC. Its deadline is 04:00 UTC, so it remains legitimately in progress. All three fixed routes have successful new observations and no wrong-region jobs. Read-back verified SHA-256, size, schema, exact catalog IDs, observation timing, price counts, and regional provenance for one immutable archive from each region, all collected after restart. This sampled audit does not establish whole-hour completeness or verified pump truth.

Scheduled retention recovered at 03:20 with HTTP 200, removing/marking 72 eligible operational objects, with zero provider requests. No eligible objects remained. Archive accounting was 744,776,963 bytes against the unchanged 900,000,000-byte budget. All five monitoring schedules remain active, and there is no active shared cooldown or unresolved operational projection repair. Trends continues to serve all ten scopes from the last complete 01:00 sweep; the incomplete hours have not been published as complete.

One restart was used; no code deployment was needed. App responses, scheduled collection, sampled immutable archives, and retention are verified recovered. Completion of the current hour is not claimed. The underlying cause of recurring database unavailability remains unresolved; this is operational recovery, not a permanent fix.
