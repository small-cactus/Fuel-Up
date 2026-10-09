# October 9, 09:14 UTC database outage

The continuous monitor found both Home and national Trends exceeding their
20-second deadlines. Protected status and health queries failed with PostgreSQL
57014 statement timeouts. Supabase's dashboard independently reported Unhealthy,
Database not usable, and TCP CONNECT_TIMEOUT after 5009 ms. Six provider-free
regional health and wrong-region guard checks passed. The observed failure was
database availability; these diagnostics do not establish the exact underlying
trigger or outage onset. The preceding 08:07 check found all 37 expired operational
hours complete and normal current-hour progress.

## Recovery attempt 1

Initiated one project restart at approximately 09:16:20 UTC under the existing
proactive recovery authorization. The dashboard and project API acknowledged
Restarting. All 23 focused retention, regional-routing and GraphQL error tests
passed. No code deployment, billing, compute-size, provider routing, identity,
budget, collector enablement, ranking, raw-price or retention-policy change was
made. No provider collection was manually triggered. Original response evidence
is retained in before-restart.json and the dashboard screenshots.

Recovery verification is pending below; a restart acknowledgment is not proof of
restored service. This is the first repair action for this incident, of at most
three authorized tested attempts. The phone app was not opened.

## Verified database and scheduled collection recovery

PostgreSQL restarted at 09:21:04.966269 UTC with the existing 96 MiB shared-buffer
setting intact. The dashboard reported Healthy. Home returned HTTP 200 with
37 quotes in 2,010 ms, and Trends returned HTTP 200 in 391 ms using its previous
completed 08:00 snapshot. No active shared cooldown or waiting lock was observed.

Saved database evidence shows a 100-second dispatcher timeout beginning at 09:14,
13 failed national Cron executions at 09:15–09:17, and a regional claim HTTP 503
at 09:18. The original failures remain recorded. No new Cron failure occurred
after 09:21:30. These operational failures were not relabeled successful batches.

Scheduled collection resumed without manual collection. Read-back verified SHA-256,
exact catalog IDs, price schema, and provenance for one successful immutable batch
per fixed region. The Virginia batch was observed at 09:22:24, after restart.
Western samples predated restart because their regional work was already complete.
This is a sampled integrity audit, not a whole-hour audit or verified pump truth.

The 09:00 sweep (run 11238) completed all 72 batches / 141,660 IDs at 09:23:36 UTC,
well before its 10:00 deadline. All 39 operational slots through 09:00 are complete,
including a comparison against expected absent slots; no partial or expired missing
hour exists. At that point one derived summary awaited ordinary automatic replay
before the completed Trends cache could advance.

A 61.286-second advancing resource sample after restart measured 314.25 MB swap-in,
401.42 MB swap-out and 25.95% CPU IO wait, with no OOM-kill counter increment.
This establishes continued resource pressure, not the exact original outage trigger
or a permanent repair. No paid upgrade or billing change was made.

## Final serving verification

The automatic projector repaired the single missing summary (job 807164) at
09:24:05. All ten Trends scopes published the completed 09:00 run at 09:25:00.
At 09:25:33 Home returned HTTP 200 / 37 quotes in 1,619 ms and Trends returned
HTTP 200 in 513 ms with completedAt 09:23:36.085533. The latest completed sweep
has zero missing summaries; all three regional assignments match and all 39
operational hours are complete without gaps. The completed sweep observed 141,660
catalog IDs, of which 92,422 had prices; missing prices are not fabricated.

Archive accounting is 712,908,256 bytes against the unchanged 900,000,000-byte
budget. All five service schedules remain active. Retention's last recorded
successful execution before restart was 09:10 (zero deletions/provider requests),
and its next scheduled execution is 09:30; post-restart retention execution is
not yet claimed. No object was eligible for retention at the final check.
Original research and evaluation data remain untouched.

Recovery is verified for database availability, scheduled collection, sampled
immutable archive integrity and the latest complete app Trends cache. One repair
action was used: the project restart. The automatic summary replay required no
operator repair or deployment. Recurring database resource pressure remains
unresolved; the monitor stays active. Evidence is committed and pushed separately
from any claim of a permanent fix.
