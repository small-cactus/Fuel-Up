# November 18 database access degradation

At 01:22–01:28 UTC, full status and fallback reads timed out, and independent
host metrics timed out. Narrow protected queries succeeded: current run 66208
(01:00, deadline 02:00) had 16 successful and 56 queued batches, with the latest
observation at 01:14:38. The 00:00 and 23:00 sweeps were complete. No new missed
hour is inferred from unavailable data or the still-open current hour.

The dashboard reported Unhealthy and severe memory commitment (1.34 GB), with a
397.17 MB memory-usage label. These charts ended at 01:15; they are not precise
current swap/I/O rates. Network, disk and connection charts did not load. Logs
showed national dispatch, Trends and projection-repair cron startup timeouts,
statement cancellations, SSL resets, a regional-claim HTTP 500, a 14.3-second
transaction-lock wait and an 11.4-second pg_stat_statements metadata read.
A separate activity snapshot showed no Lock wait or idle transaction.

Configuration remained enabled and continuous. The old upstream-transient
cooldown expired at 00:09:37; recent events were serving client timeouts, not a
new provider denial. The compact retention index remains 27,828,224 bytes with
four key columns and no INCLUDE clause, unchanged from the previous healthy
check. Size alone does not establish bloat. PostgreSQL had not restarted since
November 14 at 10:52:34.

At approximately 01:29:15 UTC, the authorized full-project restart was accepted
and the UI displayed Restarting. This is **attempt one for this recurrence**.
The November 8 and November 14 incident records were read before repair. The
full restart follows the previously verified recovery path; no speculative
index change, billing change, provider replay, raw-price overwrite, config
re-enable or city collection was performed. Original research and evaluation
data remain protected. Restart acceptance is not service recovery.

Recovery verification is in progress. Initial sanitized evidence is in
[initial-evidence.json](initial-evidence.json). Operational observations cover
a fixed inventory and are not verified pump prices.

## 01:34–01:37 UTC: scheduled collection and archive recovery

PostgreSQL restarted at 01:33:51.446667 UTC. The dashboard returned Healthy and
protected status/host metrics succeeded. shared_buffers remains 12,288 8 KiB
pages (96 MiB), pending_restart=false. All six required schedules are active.
The current sweep advanced from 16 to 24 successful batches, including completion
of the southwest route. At 01:35 the latest complete Trends cache remained the
00:00 run across ten scopes, with zero latest-run projection backlog. Three old
November 10 derived gaps remain unchanged. Retained eight-day reconciliation
shows 188 complete, three previously known partial and one current running slot;
zero expired absent/running slots. Intentionally expired older metadata cannot
support a fresh all-time recount; saved historical gaps remain reported.

At 01:36:56, immutable Storage read-back passed SHA-256, byte size, exact station
IDs, schema, observation windows and provenance for one successful object in
each region. East and southwest samples were collected after restart; northwest
completed before the outage. This is integrity sampling of three objects, not
all 72 or a complete-hour claim. No provider requests were made by verification.

A 61.3-second resource interval ending 01:36:03 recorded 332 MB swap-in, 459 MB
swap-out, 18.80% CPU I/O wait and 176 MB available RAM; counters advanced and no
OOM kills were recorded. Resource pressure persists despite restored access.
The compact index remains valid/ready and unchanged at 27,828,224 bytes.

The 01:10 and 01:20 national retention workers returned HTTP 503 during the
incident, and 01:30 cron startup failed. Eligible raw objects and overdue metadata
were zero at 01:35; post-restart scheduled retention still needs verification.
Local-history retention at 01:17 timed out, following successful 00:17 execution;
13,746 old daily rows remain versus 71,943 at the previous heartbeat. This
reduction is not attributed to the failed cron invocation or to our restart.
The bounded local-history schedule remains active, with its next run at 02:17.
