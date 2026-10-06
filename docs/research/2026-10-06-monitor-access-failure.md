# Collector monitoring access failure

Heartbeat: 2026-10-06 07:48 UTC. Project: `vjindchxfebaltbslqwc`.

Both existing status scripts failed before executing their health queries. The
pinned Supabase CLI returned HTTP 500 while initializing its database login role:
`FGA Authentication Error. Unauthorized`.

Evidence from independent read-only requests:

| Request | Result / error event ID |
| --- | --- |
| City status | `50b29b480062456787497ec1b4090f8a` |
| National status | `7f84b20393594337ab3a18e23faef1a2` |
| Supplemental slots/cron/archive audit | `f6b493d431584a33b7418b18eb7d5fa6` |
| National status retry | Same FGA authentication error |
| CLI project listing | `59e2a1e4cc2b47879f22030c7fe11bcb` |

Provider-free, authenticated health requests to all three existing workers
returned HTTP 200 and `region_verified`: Virginia (`us-east-1`), Northern
California (`us-west-1`), and Oregon (`us-west-2`). The western gateway region
headers also matched their configured regions. These checks validate worker
reachability and routing, not scheduled collection or database health.

The last successful audit at 06:51 UTC showed city collection active with 3,138
successful city-hours, 54 historical missed city-hours, and no overdue jobs.
National collection had 114 complete of 129 expected hourly slots; the 10 partial
and 5 unstarted expired slots were unchanged, with the latest gap October 4 at
10:00 UTC. The 06:00 sweep completed all 72 batches and observed 141,660 IDs.
Archive metadata checks found no missing objects, hashes, or byte-count mismatch;
accounted archive size was 441,278,753 of 900,000,000 bytes. These are prior-audit
results, not verification of the 07:00 sweep.

Current slot completion, cron execution, cooldowns, and immutable archive state
remain unverified. The failure affects management access and is not evidence
that collection has stopped. Its underlying cause (platform authorization service
versus account credentials/permissions) is not yet established.

No collector state, schedule, identity, routing, budget, or data was changed. No
provider collection was invoked. No phone app was opened. No collector repair
attempt was made because there is no verified collector defect. Further full
audits require working Supabase management authorization; retry on the next
heartbeat and report recovery once protected database checks succeed.
