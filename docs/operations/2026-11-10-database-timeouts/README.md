# November 10 database access degradation

**Current outcome, 16:18 UTC:** Scheduled collection, fresh Trends publication,
app API delivery, retention and regional immutable archive read-back are verified
restored after the third recovery attempt (full project restart). Resource
pressure remains; this is service recovery, not proof of a permanent capacity fix.
The hourly monitor remains ACTIVE. See the final verification section below.

The 12:42 UTC monitor encountered a new incident after verified healthy collection
through 11:00. Full status and supplemental reads failed during login-role setup
with HTTP 544. The bounded SQL fallback and a three-run query timed out on the
server. A direct authenticated REST read also timed out after 12 seconds.
Independent host metrics timed out at 15 seconds; a longer diagnostic attempt
returned HTTP 504. No current RAM, swap or I/O measurements are available.

A narrow primary-key run read succeeded: the 12:00 scheduled run 55496 exists and
remains running. Its deadline is 13:00 UTC. Batch-count and configuration reads
failed before execution, so no exact progress, current cooldown, new partial-hour
count or expired absent-slot count is asserted. Unavailable data is not a gap.
The last verified complete Trends cache is the 11:00 run 55436, published at
11:18 in ten scopes. At that check there were 13 previously reported partial
hours, no expired absent/running slots, and no projection or retention backlog.

Small activity reads succeeded intermittently. They showed 12 idle client
connections and two active clients, no idle-in-transaction sessions, and no
blocking PIDs in the active-client snapshot. One active query was an existing
price-alert claim and the other was the diagnostic read. Neither was cancelled;
this snapshot does not establish a cause or justify terminating application work.
The last healthy compact retention index was 8,724,480 bytes, substantially below
the former 129 MB index. A fresh size read also failed during login-role setup. No speculative
reindex or schema change was performed.

Safari still displays the GitHub sign-in page for Supabase, with empty credential
fields. This blocks the established dashboard server-log and project-restart path.
No credentials were entered. Sign-in is required from the user to proceed through
that path; the existing authorization for scoped repair remains in effect.

Zero production repair attempts, zero monitor-triggered provider requests, and no
restart, re-enable, billing, routing, budget or raw-price changes. The city campaign
and research data were not modified. Scheduled service recovery and immutable
archive read-back remain unverified. Continue diagnosis from the saved evidence
and verify those outcomes once access recovers; do not replay missed collection.

Evidence is sanitized: credentials, response headers and SQL account-identifying
comments are omitted. Temporary filenames are labels; embedded observation times
are authoritative.

## 13:40 UTC: confirmed gap and two bounded recovery attempts

Run 55496 (12:00) closed partial at 13:00:05: 31 successful batches, 41 missed.
The successful batches used 32 attempts, and the missed group had one attempted
request. The last successful observation was 12:08:15. Run 55521 (13:00) exists
with all 72 jobs queued and zero attempts at the successful diagnostic read.
Its deadline remains 14:00. Current absent-slot totals are unavailable; no
additional gaps are inferred from failed reads.

The full bounded status and fallback SQL timed out again, and independent host
metrics timed out. A narrower primary-key read and job-group read succeeded,
providing the counts above.

An additional recovery path was found in scripts/operations/README.md: the
existing Supabase CLI supports a restart-capable PostgreSQL configuration update.
A read of the current overrides returned only shared_buffers=96MB. The documented
CLI preserves existing overrides unless explicitly told to replace them. The
[official configuration guide](https://supabase.com/docs/guides/database/custom-postgres-config)
and [Management API schema](https://api.supabase.com/api/v1/) document restart
behavior and the restart_database boolean. The versioned CLI update handler was
inspected before using the command; no new code was deployed.

Two production recovery attempts were made under existing authorization:

1. Reapplied shared_buffers=96MB without changing its value or replacing overrides.
2. After no verifiable recovery, requested restart_database=true through the same
   CLI configuration endpoint, preserving shared_buffers=96MB.

Both commands returned success with the same configuration. Neither response
proves PostgreSQL restarted: before/after postmaster-start reads failed with
connection timeouts, and the post-attempt status still failed. Management status
ACTIVE_HEALTHY is likewise not service-health proof. No third attempt was made.
Future repair work must retain the two-attempt count for this incident and must
not repeatedly issue unverified restarts.

No billing, provider routing, budgets, activation state, raw prices or research
data changed. No manual provider collection was invoked. There is no verified
service recovery or new immutable-archive read-back. Dashboard sign-in remains
the established blocker for direct project restart and server-log access.
The previous statement of zero attempts describes the initial 12:42 check only.

Validation consists of current configuration read-back and explicit failed live
recovery checks; no source change or unit-test claim is made. followup-1340.json
preserves sanitized results.

## 14:44 UTC: restart confirmed, service still degraded

The fallback database read succeeded at 14:45:33 despite another failed full
status request. The 13:00 run 55521 closed partial at 14:01:00 with all 72 batches
missed and zero attempts. Together with 12:00, this incident has 113 confirmed
missed batches. The 14:00 run 55542 had one successful batch and 71 queued; its
deadline is 15:00. The retained eight-day window contains 176 complete hours,
15 partial hours, one running hour, zero expired absent slots and zero expired
running slots. These totals include the 13 previously reported partial hours.

All required schedules remain active. Continuous collection remains enabled,
the shared cooldown expired at 12:05:15, and no re-enable is warranted. The last
complete cache remains run 55436 (11:00), published at 11:18 in ten scopes.
Current capacity and full projection/retention backlog are not freshly verified.

A server-state query at 14:45:58 confirmed PostgreSQL started at 13:50:48.462786,
after the two earlier accepted recovery requests. The shared_buffers value is
12,288 8 KiB pages (96 MiB), pending_restart=false. This confirms a restart after
those requests, but does not identify which request caused it or prove recovery.
The service remained degraded afterwards. Saved responses show HTTP 503 database
claim failures in all three expected regions and NATIONAL_RETENTION_FAILED at
14:40. No routing mismatch was observed.

The retention reference index is 8,765,440 bytes; price-order and primary-key
indexes are 35,766,272 and 23,150,592 bytes. This does not demonstrate recurrence
of the former 129 MB index defect. A fresh activity sample had seven idle client
connections, only the diagnostic query active, no lock blockers and no idle
transactions. No query cancellation or speculative reindex was justified.

The first successful resource sample returned identical counters across 20.8
seconds. Cached metrics cannot establish current I/O or swap rates, and are not
interpreted as healthy zero activity. A longer interval was sampled separately.

Safari was checked again and remains signed out of Supabase. The official CLI's
keyring-library path was investigated as an alternative for the documented direct
restart API, but the credential read blocked and was interrupted. No credential
was retrieved or logged, no new credential/access grant was created, and no direct
restart request was sent. Repair count remains two; no third speculative restart
was attempted after the already-confirmed restart failed to restore service.
Dashboard sign-in remains necessary for the established deeper server-log path.

The longer pressure check timed out. A final full status request hit its server
statement timeout, its host metrics timed out, and its fallback database read
failed at connection setup. Scheduled recovery and immutable archive read-back
remain unverified. No additional gaps are inferred from these failures.

## 15:33 UTC: signed-in diagnosis and full project restart

The user completed Supabase sign-in and explicitly directed continued repair.
The signed-in dashboard showed the project Unhealthy. Database observability
reported severe memory commitment (1.54 GB), 1.67 GB database use on an 8 GB disk,
and unavailable connection/I/O charts. Logs showed cron startup timeouts and
statement cancellations; even small metadata/settings queries took 13–19 seconds.
A fresh CLI status timed out on both full and fallback SQL, while independent
host metrics returned load1=14.03, about 135 MiB available RAM of 411 MiB, and
about 450 MiB swap occupied. One sample cannot establish swap or I/O rates.
The December 2 quota-grace banner is not evidence of an active quota restriction.
No billing change was made.

The separate full-project restart was chosen because the earlier PostgreSQL
restart did not restore service and evidence showed broader resource/service
pressure. The General settings UI explicitly offered Fast database reboot as a
separate dropdown option; that option was not selected. At approximately 15:37
UTC, Restart project > Restart was accepted and the UI showed Restarting server
and project unavailable during restart. This is production repair attempt three
of three for this incident. No further repair should be issued without accounting
for this limit. A bounded SQL check during restart returned HTTP 400, database
possibly not accessible. Recovery is not established by restart acceptance.

At 15:41:44 the server read succeeded and confirmed a new postmaster start time
of 15:41:10.930011, still with shared_buffers=96MB. The dashboard returned Healthy
and the full protected status read succeeded. The 14:00 run had closed partial
with one successful and 71 missed batches, making 184 confirmed missed batches
across the three incident hours. The retained window had 16 partial hours
(including 13 earlier known partial hours), zero expired absent/running slots,
and one current running hour. All six required schedules were active. Archive
usage was 722,803,938 of 900,000,000 bytes. All three maintenance indexes were
valid and ready, with no recurrence of the old oversized INCLUDE index.

Scheduled collection began advancing after restart: by 15:42:35 all four us-west-2
batches were successful. This proves partial scheduled progress only. The latest
complete cache remained the 11:00 run, and three operational metadata runs were
past the retention-age threshold. Full current sweep, fresh cache, retention
success and archive read-back still need verification at this checkpoint.

At 15:45:36 immutable archive read-back passed for one post-restart batch in each
fixed region. SHA-256, compressed size, exact requested station IDs, price schema
and provenance were verified by auditRegionalSample.mjs. The source run was still
running, so this is explicitly a three-batch integrity sample, not evidence that
all 72 batches had completed or that observations equal verified pump prices.
The sanitized report is archive-55572.json; response headers were removed.

A single upstream HTTP 503 at 15:44:43 used the existing five-second shared
cooldown. The queued retry succeeded without operator intervention or re-enable.
Both western routes completed, and the eastern route continued through its fixed
schedule. No monitor-triggered provider collection was performed.

The 15:50 broad status query again hit its 15-second statement timeout. Host
metrics and the smaller fallback query succeeded, and independent narrow reads
confirmed ongoing collection. This is not labeled fully healthy monitoring.
The 15:50 retention worker returned HTTP 200: two old operational hours removed,
one deferred, 100 content references detached, no raw objects removed. At 15:51
archive accounting was 724,754,476 of 900,000,000 bytes, with zero raw retention
candidates and one old operational metadata run remaining. Bounded retention
continues to protect the original research and latest published cache.

A 60.5-second host sample ending 15:52:56 showed continued pressure: 374.5 MB swap
read, 314.3 MB swap written, 22.57% CPU I/O wait, about 104 MiB available RAM,
and no new OOM kills. Counters advanced, so these are measured interval values,
not cached zero deltas. The full restart restored database access and scheduled
progress, but it did not eliminate resource pressure or prove permanent recovery.
No fourth repair, paid upgrade, budget increase or collection replay was issued.

The 15:00 sweep 55572 completed at 15:57:24.544365, with all 72 batches and
141,660 fixed-inventory observations, 90,353 stations with reported prices,
zero missed batches and zero route mismatches. The regional totals were 59 east,
9 southwest and 4 northwest. Its 73 requests and 143,660 lookups remained under
92 and 161,660 limits. All 72 archive references remained undeleted. This proves
scheduled collection recovery after the full restart, not verified pump truth.

Five trend projections were missing immediately after completion. The normal
projector successfully replayed one immutable archive at 15:58 and another at
15:59, with zero provider requests. Three remained when run 55615 for 16:00
started. The existing projection guard intentionally pauses optional replay
while collection is running. It was not bypassed. The cache remained on the last
complete projected run, so cache recovery was still pending at 16:01.

The 16:00 retention worker also succeeded (HTTP 200), removed two overdue metadata
hours, detached 92 references and reported zero deferred operational hours.
No raw objects were removed. Thus retention execution recovered and its earlier
metadata backlog cleared. All required cron entries remained active and their
most recent completed invocations succeeded.


## Final verification: scheduled service and app cache restored

The next scheduled run, 55615 for 16:00, completed at 16:16:04.171999 with all
72 batches and all 141,660 fixed-inventory observations, 90,445 stations with
reported prices, zero missed batches and zero route mismatches. All fixed
regional allocations completed (59/9/4). Two normal upstream 503 retries made
74 total requests and 145,660 lookups, below the 92/161,660 hourly budgets.
No provider denial was overridden; the latest cooldown expired at 16:14:58.179185.
The authoritative exact configuration timestamps are in final-recovery.json.

At 16:17:00.227915 all ten Trends cache scopes published run 55615. At 16:17:34
it matched the latest complete run with zero missing trend projections and zero
pending operational repair records for complete runs. The earlier 15:00 run still
had three unprojected batches at its last targeted check; it was superseded by the
fully projected 16:00 run. Its immutable raw archives remain intact. Do not confuse
zero latest-run backlog with proof every older derived batch was backfilled.

At 16:17:40, all ten fuel/E85 combinations returned HTTP 200 through the same
`gas-prices` Edge Function and fixed us-east-2 API region used by the app. Every
response had source=national-cache, scanId=55615, five quotes, 151 history points
and no history error. Observed request durations were 140–774 ms. This verifies
API delivery without opening the phone app and without contacting the provider.

At 16:17:22, immutable Storage read-back passed for one successful batch from each
fixed collection region in the completed 16:00 run. Hashes, compressed sizes,
exact IDs, price schema and provenance matched. The sanitized report is
archive-55615.json. This is a three-batch integrity sample, not an audit of every
raw object or proof of pump truth. Coverage is against the fixed 141,660-station
catalog, not a newly verified nationwide station inventory.

Final narrow reads at 16:18:23 showed 729,904,203 of 900,000,000 archive bytes,
zero eligible raw-retention objects, zero overdue operational metadata runs,
and a successful 16:10 retention response with no deferred hours. The compact
reference index was 9,216,000 bytes and valid/ready; price-order and primary-key
indexes were also valid/ready. There is no recurrence of the former 129 MB
INCLUDE index. Database size was 1,778,568,339 bytes. The retained eight-day slot
check had 176 complete, 16 partial and zero expired absent/running slots; the
16 partial hours comprise 13 known earlier gaps plus this incident's three.
The three outage hours contain 184 confirmed missed batches and were not replayed.

All required schedules and continuous collection remain enabled. The Codex hourly
monitor was read back ACTIVE and was not modified. The original research/city
campaign, fixed collection routes, budgets, raw data and billing were unchanged.
Three recovery attempts were used; no fourth was made. Final evidence is in
final-recovery.json, including the observed progress timeline. Resource pressure
and the 15:50 broad-query timeout remain recorded limitations; do not describe
this restart as a proven permanent fix. Validation used protected live reads,
real app API responses, immutable archive audits, JSON assertions and diff checks;
no application source or schema change was made in this interactive recovery.
