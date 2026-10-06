# October 6, 10:57 UTC database incident

The national 10:00 sweep stalled after 26 of 72 batches (49,960 of 141,660
catalog IDs). Its last provider request was at 10:05:21 UTC while scheduled
dispatch continued through 10:57. At initial observation its 11:00 deadline had
not yet passed. The prior 09:00 sweep completed all 72 batches. City collection
reached 3,234 successful city-hours and 64,680 observations, with the unchanged
54 historical misses, no queued-due jobs, and latest success at 10:49:56.

The shared provider cooldown had expired at 06:10:49. The collector and all
three assigned regions remained enabled. No newer provider access or rate denial
was present in the status response. Accounted archives were 453,369,318 of the
unchanged 900,000,000-byte budget. The latest complete serving projection was
current for the 09:00 sweep.

## Diagnosis and evidence

- A protected database diagnostic could not initialize its login role: HTTP 544,
  `Failed to create login role: Connection terminated due to connection timeout`.
- The supplemental slots/cron/archive query failed with Management API HTTP 524
  at 11:00:16 UTC (Cloudflare ray `a4642646fabbd941`).
- An authenticated Data API read timed out after 15 seconds.
- The Virginia worker's provider-free protected health check returned HTTP 200
  and matching `us-east-1` provenance. Worker reachability did not establish DB
  or collector health.
- The dashboard Advisor explicitly reported `Database not usable`, TCP
  `CONNECT_TIMEOUT` after 5002 ms, despite the separate overall Healthy badge.
- A short resource sample had non-advancing counters. Its 431,304,704-byte RAM
  capacity and 581,324,800 free swap bytes are retained, but it cannot establish
  current swapping rates or the cause of this outage.

The available evidence establishes a database availability incident. It does not
prove a specific memory, lock, or infrastructure cause. Prior memory-pressure
mitigations are not proof that this incident has the identical cause.

## Recovery attempt 1

At approximately 11:02 UTC, restarted only this project through its authenticated
Supabase dashboard under the user's proactive recovery authorization. The UI
confirmed Restarting. No configuration, compute plan, budget, routing, identity,
attempt counter, or research deadline was changed. No manual provider collection
was triggered, and the phone app was not opened.

The 10:00 hour's deadline elapsed before the restart. Its partial observations
must remain historical evidence; no backfill or deadline extension is allowed.
Twenty-three focused cache-serving, archive, regional-routing and projection
repair tests passed. No executable code changed or deployment was needed.

During restart, Home's authenticated cache-only API returned HTTP 503
`CACHE_UNAVAILABLE` in 8.2 seconds. Metrics returned HTTP 522; these checks are
not recovery evidence. A first Home probe omitted the API authorization and
returned HTTP 401; it was corrected and is not treated as a service defect.

## Recovery verification

PostgreSQL restarted at 11:06:33 UTC. Protected database queries succeeded again
at 11:07, with `shared_buffers=96MB` unchanged. Saved scheduled worker responses
confirm `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED` before recovery across
the three assigned regions, supporting database failure rather than provider
rejection. The 10:00 run is preserved as partial: 26 succeeded and 46 missed
batches. Across 134 expected national hours, 117 are complete, 11 expired partial,
5 expired unstarted, and the 11:00 current hour remains before its deadline.

At 11:07:28 the real authenticated Home cache-only endpoint returned HTTP 200,
47 regular-fuel prices, and the unchanged reported-last-24-hours policy in
1,233 ms. This is server endpoint verification, not a phone visual test.
All three provider-free regional checks returned HTTP 200 and correct routing.

The 11:00 run resumed via ordinary Cron and reached six successful batches by
11:09. Main schedules and watchdogs remain enabled. Saved Cron failures include
the outage and restart; they are not erased or reclassified.

An advancing 61.2-second post-restart resource interval measured 311 MB swap-in,
362 MB swap-out and 21.1% CPU IO wait. No OOM increment occurred in this interval.
This demonstrates continuing memory/IO pressure after recovery, not proof of
the exact initiating cause. A restart is a mitigation, not a permanent resource
fix. The user declined a paid upgrade; no billing or plan change was made.

At 11:10:30, immutable read-back verified a new successfully scheduled batch
from each assigned region after restart. SHA-256 hashes, byte sizes, exact ID
sets, timestamps within the original research deadline, price schemas, and
regional provenance passed using the committed `auditArchive.mjs` verifier.
This sample verifies resumed archive writes; it does not establish that the
whole 11:00 sweep is complete, and does not verify pump prices.

All collection main/watchdog jobs executed successfully again by 11:10, with
no city jobs overdue and zero wrong-region jobs. The current 11:00 sweep remains
in progress before its deadline, not a missed hour. Recovery used one restart;
no second repair attempt was needed. Remaining capacity and workload pressure
continue to be monitored under the unchanged campaign and plan.

Dashboard screenshots were saved locally as
`/tmp/fuel-database-restarting-20261006.png` and
`/tmp/fuel-database-recovered-20261006.png`; they are supporting UI evidence,
while the committed query, endpoint, and archive artifacts verify service state.
