# October 8, 14:47 UTC database outage

The continuous monitor found Home returning HTTP 503 `CACHE_UNAVAILABLE` after
17.7 seconds and national Trends exceeding its 20-second request deadline.
Both protected health queries failed with PostgreSQL statement timeout (57014).
A subsequent activity diagnostic failed to create its temporary login role
(HTTP 544, connection timeout), and authenticated resource metrics timed out.
The Supabase dashboard independently reported Unhealthy / Database not usable /
TCP CONNECT_TIMEOUT. Six provider-free regional health and wrong-region checks
passed, isolating the observed problem to database availability rather than a
regional routing failure. The exact pre-restart trigger could not be measured.

## Recovery attempt 1

Performed one project restart through the authenticated dashboard at approximately
14:51 UTC, under the existing proactive recovery authorization. PostgreSQL's new
start time is 14:53:48 UTC. No billing, compute, configuration, provider identity,
routing, budgets, ranking, retention, raw data or collector enablement was changed.
No provider collection was manually triggered. Fifteen focused collector,
retention and regional tests passed; this was an operational recovery, not a
code change or deployment.

Saved database response evidence after restart shows repeated regional claim
HTTP 503 errors and a 100-second dispatch timeout during the outage. The
`ARCHIVE_WRITE_FAILED` event and subsequent timeout events for job 726236 remain
preserved. A succeeded batch is not inferred from those failures: scheduled
retry and immutable archive read-back provide the recovery evidence.

The 14:00 sweep (run 10114) completed all 72 batches / 141,660 catalog IDs at
14:55:15 UTC, before its 15:00 deadline. All 20 operational slots through 14:00
are complete, including expected slots without relying solely on existing rows.
No operational hour was missed. Fresh post-restart scheduled collection and
successful Cron executions are recorded in after-restart.json and database-after.json.

Home returned 34 quotes in 1,296 ms; Trends returned its previous completed
13:00 sweep in 465 ms while seven missing 14:00 summaries entered automatic
repair. The first two repaired summaries completed at 14:56 and 14:57. This
snapshot alone does not claim the latest Trends cache had caught up.

Regional read-back verified one immutable batch per fixed region: SHA-256,
exact inventory IDs, price schema and regional provenance. The Virginia sample
was collected after restart. Western samples predate restart because their
assigned work had already completed. This is sampled verification, not a
whole-hour archive audit or verified pump truth.

The first advancing post-restart 60.94-second metrics sample measured 76.6 MB
swap-in, 110.7 MB swap-out and 6.76% CPU IO wait with no OOM counter increment.
The existing 96 MiB shared-buffer override remained in place. These measurements
still show swapping and do not establish the exact outage cause or a permanent
fix. The previously declined paid upgrade remains unchanged.

Further scheduled recovery verification is appended below when available.

## Recovery attempt 2: four missing derived summaries

The existing projector pauses during every active sweep and selects only the
latest completed run afterward. At the 15:00 boundary four 14:00 summaries
remained missing (jobs 726235, 726236, 726237, 726239). Leaving these to that
scheduler could strand the completed hour once the next run completed.

Used the existing insert-only, idempotent `record_fuel_national_trend_batch` RPC
for exactly those four jobs, serially, after validating each immutable archive
with the committed audit routine. The incident-specific script refuses any
other run, job IDs, incomplete sweep or wrong regional routing. All 72 summary
rows now match their archived source hashes. Seven archive/replay tests and
syntax validation passed before execution. The receipt records zero provider
requests, zero raw writes and zero serving-price writes. This was the second
scoped recovery action; no production code or scheduler was changed.

At 15:03 the new 15:00 sweep had 17/72 batches complete across all three fixed
regions, with no wrong-region jobs or missed batches. All 20 expired operational
hours were complete; the new hour remains within its deadline. Retention ran
successfully at 15:00 with zero deletions and zero provider requests. No Cron
failure occurred after 14:55, and no active shared cooldown or unresolved
operational repair lease remained. Archive storage remained below budget.

## Final serving verification and remaining scheduled work

At 15:04:51 national Trends returned HTTP 200 in 919 ms, five quotes and no
history error, still identifying the 13:00 completed snapshot. This is not a
claim that Trends caught up. Source inspection confirms the publisher's explicit
consistency guard: once a newer run has updated station projections it waits for
that run to complete, rather than publish mixed-hour prices. The 15:00 run was
already active when the final four historical summaries were restored. Its
scheduled completion/publication is pending within the normal 16:00 deadline.
No guard was bypassed and no partial sweep was labeled a published complete one.
The next heartbeat must verify this pending cache advance and the active sweep.

Immediate recovery is verified for database availability, Home, scheduled
collection, completed-hour coverage and derived historical summaries. Recurring
database failure remains a limitation, and Trends' next snapshot remains pending.
This incident used two scoped recovery actions (one restart, one four-summary
archive replay), both with successful relevant validation. No production code
change or deployment occurred. The phone app was never opened.
