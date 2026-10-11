# October 11 03:13 UTC database outage

The hourly monitor's status and supplemental health queries both failed with HTTP 544: `Failed to create login role: Connection terminated due to connection timeout`. Supabase independently reported **Unhealthy**, **Database not usable**, and TCP `CONNECT_TIMEOUT` after 5003 ms. Dashboard metrics displayed CPU 46%, disk 10%, RAM 64%, and unavailable connections. These observations establish database unavailability, not its underlying resource cause.

Home and Trends requests both exceeded a 20-second timeout. Before this incident, the 02:12 UTC check showed the 01:00 sweep complete, the 02:00 sweep progressing at 55/72 batches, no new gaps, no active shared cooldown, and healthy retention. Current collector configuration cannot be inspected while login-role creation is unavailable. Nothing indicates a deliberate pause or provider access denial.

## Repair attempt 1

All 23 focused regional-routing, GraphQL-error, and retention tests passed. A single project restart was initiated through Supabase at approximately 03:16 UTC under standing repair authorization. No provider collection was manually triggered, and no code, budget, routing, identity, billing, retention policy, ranking, or raw observations were changed. Recovery remains to be verified; restart acknowledgment alone does not establish it.
