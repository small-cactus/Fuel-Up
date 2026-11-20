# November 20 database degradation

At the 01:03 UTC check, full status and nearly all split protected SQL reads
failed. Independent fallback host metrics showed load averages 8.68 / 9.29 /
10.52, 137,494,528 bytes available RAM and 533,770,240 bytes occupied swap.
These are snapshots, not measured interval I/O rates. A pressure sampler timed
out. This is more severe than the intermittent monitor-only timeouts previously
observed while collection continued normally.

A successful minimal read at 01:06:10 confirmed midnight run 69009 closed partial
at 01:01:00. Run 69035 for 01:00 remained running, with its deadline at 02:00.
The latest provider request was at 00:03:22. Configuration remained enabled and
continuous; the old transient cooldown expired November 19 at 22:15:08. No
new gap is inferred from failed reads or from the still-open 01:00 slot.

The authenticated dashboard reported Unhealthy. Logs showed database claim and
national Trends RPC HTTP 504s, SQL statement timeouts, and a 1.69-second role
lock wait. A small index/activity query also failed during connection setup.
The last verified compact index size was 28,319,744 bytes at midnight, with four
key columns and no INCLUDE; current size remained unverified before recovery.

After reading the November 8 and November 18 incident procedures, one full-project
restart was accepted by 01:09:14 UTC. This is attempt one for this recurrence.
It follows the previously verified recovery path for internal database failure.
Acceptance alone is not recovery. No provider replay, collection re-enable,
routing change, billing change, schema/index change, raw-price overwrite or city
collection was performed. Original research and evaluation protections remain
unchanged. Operational observations cover the fixed inventory, not verified pump
truth.

The dashboard separately warns that prior-cycle quota was exceeded and projects
will be restricted from December 2 if the organization remains over quota. This
is a future restriction warning, not proof that quota enforcement caused today's
failure. Billing has not been changed.

`initial.json` contains sanitized failure, host, minimal SQL and dashboard evidence.
Post-restart verification follows below.

## Verified recovery progress

PostgreSQL restarted at 01:13:20.319639 UTC and the dashboard returned Healthy.
Scheduled collection resumed at 01:14. All six schedules and the three fixed
regions remain enabled. The compact retention index remains 28,319,744 bytes,
valid/ready, with four key columns and no INCLUDE. No recurrence of the original
129 MB INCLUDE index was found; index size alone does not establish bloat.

At 01:15:59 all ten fuel/E85 Trends API combinations returned HTTP 200 using the
last complete 23:00 run 68949. The incomplete midnight run was not published.
At 01:17:16 actual Storage read-back passed SHA-256, byte count, exact station IDs,
schema, time window and provenance for one fresh post-restart batch in each of
us-east-1, us-west-1 and us-west-2. These are three successful batch samples from
running run 69035, not an assertion that the entire sweep was complete.

The 00:17 local daily-history job had failed during the outage. Its 01:17 scheduled
invocation succeeded. National retention had 72 eligible raw objects and one
overdue metadata hour at the first recovered status read; the 01:20 scheduled
worker is checked separately below. No operator catch-up or provider replay was
performed. A new upstream 502 at 01:17 imposed the normal shared cooldown until
01:18:04; the cooldown was neither cleared nor overridden.

An advancing 60.923-second resource interval ending 01:16:23 recorded 700,579,840
bytes swap-in, 729,776,128 bytes swap-out, 71,090 major faults and 21.76% CPU I/O
wait, with no OOM kills. Available physical RAM was 129,126,400 bytes. A preceding
30-second sample had cached counters and cannot establish a healthy interval.
Resource pressure persists after recovery. The restart restored service access;
it did not prove permanent resolution of the underlying cause.

The quota dashboard identifies **DB Size Exceeded** in the previous billing cycle
and warns of HTTP 402 restrictions after the December 2 grace period if the
organization remains over quota. A protected size inventory shows approximately
2.17 GB total database size, including 1.22 GB allocated to driving research
events. No research, unrelated tables, billing or retention boundary was altered
to address this separate capacity warning.

## 01:20 UTC verification and limits

The scheduled national retention worker returned HTTP 200 at 01:20:00, removing
72 operational raw objects and one overdue metadata hour, detaching 72 covered
references. Eligible raw objects, overdue metadata hours and deferred metadata
hours are now zero. This catch-up was automatic scheduled work after restart,
not a second operator repair.

The retained 192-slot window now contains 190 complete hours, the newly partial
midnight hour, and the current running hour. There are zero expired absent,
expired running or current absent slots. Midnight preserved 30,213 observations
in 16 successful batches and missed 56 batches. Older gaps whose metadata has
expired remain documented in prior incident records; this is not an all-time
zero-gap claim.

Run 69035 advanced to 18 successful batches at 01:20:35, with zero missing derived
batches among those successes. At 01:20:04 its budget was 18 requests / 35,747
lookups against 92 / 161,660 limits. All three routes have fresh successes and
zero wrong-region jobs. The 502 cooldown expired naturally and scheduled
collection resumed. The hour remains **in progress**, with deadline 02:00; a
complete-sweep or new-cache-publication claim would be premature. The latest
complete Trends cache remains run 68949 across ten scopes with zero retained
complete-run projection gaps.

Accounted archive use is 744,425,719 of 900,000,000 bytes;
Storage totals 748,700,667 bytes. Local daily-history backlog is 18,685
rows, down from 90,347 at the first recovered check. The scheduled 01:17 cleanup
succeeded; other automatic metadata cleanup can also affect row counts, so the
whole reduction is not attributed solely to its bounded delete. The next normal
local-history cleanup is 02:17. No manual data deletion was performed.

Validation: structured recovery assertions passed for configuration, deadlines,
missed-slot accounting, budgets, routing, six schedules, cache safety, projections,
retention recovery, valid indexes, archive integrity and all ten cache API checks.
Evidence is in `verified-recovery.json`, `archive-readback.json`, `trends-api.json`
and `resource-pressure.json`. No application source changed and no phone app was
opened. One operator repair attempt total; zero monitor-triggered provider calls.
Resource pressure and the December 2 quota warning remain unresolved limitations.

## 02:03 UTC: complete sweep and refreshed Trends confirmed

Run 69035 completed at 01:31:35.601760 UTC, before its deadline: 72/72 batches,
141,660 fixed-inventory observations and 92,465 priced stations. Routing was
59 / 9 / 4 batches in the three assigned regions, with zero wrong-region jobs.
It used 74 requests and 145,660 lookups, within the unchanged limits. All ten
Trends scopes published it at 01:32:00.466381; ten live API combinations and three
fresh immutable archive samples from the complete sweep passed at 02:03. Latest
complete-run and retained complete-run projection gaps are zero. Completion and
publication followed scheduled work after the prior restart, without another
operator repair or manual collection.

The 02:00 run 69085 was progressing (15 successful batches at status capture,
18 attempted requests / 33,960 lookups in the later budget read) and has until
03:00. Rolling reconciliation remains 190 complete, one known partial midnight
hour, one current running hour and no absent expired or expired-running slots.
The midnight 56 missed batches remain recorded.

All six schedules remain active. National retention at 02:00 returned HTTP 200,
removed 72 operational raw objects and one metadata hour, and detached 93 covered
references; no eligible raw objects, overdue metadata hours or deferred hours
remain. Archive accounting is 744,288,371 / 900,000,000 bytes; Storage totals
748,563,319 bytes. The local daily-history backlog is 17,538 rows; its most recent
01:17 job succeeded and the next bounded run is due at 02:17. City research stays
complete and closed.

Full status succeeded. A combined supplemental read hit its 10-second SQL timeout;
three smaller protected reads succeeded in 2.47, 2.62 and 7.18 seconds. The activity
snapshot showed no lock wait or idle transaction. The compact retention index is
unchanged at 28,319,744 bytes, valid/ready, four keys and no INCLUDE. PostgreSQL
start time remains 01:13:20 with 96 MiB shared buffers and no pending restart.

Resource pressure remains material: an advancing 60.712-second sample ending
02:04:30 recorded 757,268,480 bytes swap-in, 673,722,368 bytes swap-out, 99,070 major
faults and 64.12% CPU I/O wait, with zero OOM kills and 162,873,344 bytes available
RAM. Successful service checks do not imply that this pressure is resolved.
No further restart or index change was justified by the working collection,
publication and archive evidence. The previously reported December 2 database-size
quota warning remains an external capacity concern; billing was not changed.

`followup-0203.json` preserves structured assertions, protected reads, resource
measurements, ten API results and the three-object archive audit. No source change
or phone interaction; zero repair attempts this check, one for the incident.

## 02:59 UTC: scheduled service continues and local cleanup drained

Run 69085 completed 72/72 batches at 02:14:46.665756, with 141,660 observations,
92,471 priced stations and correct 59 / 9 / 4 regional routing. The sweep used
73 requests / 143,660 lookups, within unchanged budgets. A transient 503 cooldown
expired at 02:06:57 without intervention. Two scheduled projection replays finished
on their first attempts at 02:15 and 02:16. All ten cache scopes published run
69085 at 02:17:00.325366; latest and retained complete-run projection gaps are zero.
Three actual immutable archive read-backs passed, including southwest job 4969945,
whose projection was repaired automatically. No operator collection or repair.

At 02:59 the rolling 192-slot window has 191 complete hours and the unchanged
midnight partial hour, with zero expired absent/running slots. A separate 03:00:08
minimal read confirms scheduled run 69145 exists and has begun, with deadline
04:00. It is not yet a complete sweep. Older aged-out gaps remain in prior evidence.

All six schedules and three routes remain active. Scheduled local-history cleanup
succeeded at 02:17 and its old-row backlog is zero. National retention through
02:50 returned HTTP 200; the 02:59 snapshot has zero eligible raw objects, overdue
metadata hours or deferred hours. Accounted archive use is 747,170,047 of
900,000,000 bytes; Storage totals 751,444,995 bytes. Original research and the
closed city campaign remain unchanged. No billing or quota override was made.

Full status and all three small supplemental reads succeeded. The compact index
remains 28,319,744 bytes, valid/ready and without INCLUDE. PostgreSQL has not
restarted again. A 60.813-second interval ending 03:00:12 recorded 209,195,008 bytes
swap-in, 189,906,944 bytes swap-out, 24,589 major faults and 13.36% CPU I/O wait,
with no OOM kills and 108,920,832 bytes available RAM. The 03:00 snapshot includes
one DataFileRead wait but no lock wait or idle transaction. Pressure persists;
this interval is lower than the preceding sample, not proof of permanent recovery.

`followup-0259.json` preserves the successful checks and three-object integrity
audit. No new operational gap or repair; normal scheduled continuation requires
no new user action. The previously reported December 2 capacity warning remains.

## 04:02 UTC: continued scheduled service

Run 69145 completed 72/72 batches at 03:16:16.130092, covering the 141,660 fixed
inventory with 92,718 priced stations and correct 59 / 9 / 4 regional routing.
It used 73 requests / 143,660 lookups within budget. Two scheduled projection
replays completed on their first attempts at 03:17 and 03:18. All ten Trends
scopes published run 69145 at 03:19:00.346789; latest and retained complete-run
projection gaps are zero. These are automatic scheduled results, not new repairs.

Current run 69205 had ten successful batches at the status snapshot, with twelve
attempts / 22,213 lookups in the later budget read, and has until 05:00 UTC.
Rolling eight-day reconciliation reports 190 complete, the unchanged midnight
partial hour, one current running hour and zero absent expired or expired-running
slots. Older historical gaps remain documented. The shared cooldown expired at
02:06:57 and no newer upstream denial appears in the returned recent events.

All six schedules and three routes are active. National retention at 04:00
returned HTTP 200, removing 72 operational raw objects and one metadata hour,
with 70 detached covered references. No eligible raw objects, overdue metadata
hours, deferred hours or local daily-history backlog remain. The 03:17 local
cleanup succeeded. Archive accounting is 744,027,208 / 900,000,000 bytes and Storage
is 748,302,156 bytes. Last actual three-region immutable read-back passed at
02:59:55 and is preserved in the preceding follow-up; no fresh object audit is
claimed for run 69145. City research remains complete and closed.

Full status and all three protected supplemental reads succeeded. The compact
index remains 28,319,744 bytes, valid/ready and without INCLUDE; PostgreSQL start
remains 01:13:20. The activity snapshot had no lock wait or idle transaction.
An advancing 61.43-second interval ending 04:03:15 recorded 368,877,568 bytes
swap-in, 362,348,544 bytes swap-out, 46,804 major faults and 24.98% CPU I/O wait,
with zero OOM kills and 114,409,472 bytes available RAM. Known pressure persists;
working service does not establish permanent resolution.

Structured service assertions passed in `followup-0402.json`. No new gaps,
operator repair, provider replay, configuration change, billing change or phone
interaction. One operator repair remains recorded for this incident. The previously
reported December 2 database-size quota warning is unchanged.

## 04:59 UTC: no new gaps; next hour starts on schedule

Run 69205 completed 72/72 batches at 04:16:05.125028, covering 141,660 inventory
stations with 92,604 priced stations and correct 59 / 9 / 4 routing. It used
73 requests / 143,660 lookups. A transient GraphQL response invoked the normal
shared cooldown until 04:08:34; it expired naturally. All ten cache scopes
published run 69205 at 04:17:00.316121. Latest and retained complete-run projection
gaps are zero; no new projection-repair rows follow the previously recorded
03:18 replay. No operator repair or provider replay was performed.

The 04:59 snapshot has 191 complete hours, the unchanged midnight partial hour
and zero expired absent/running slots in its rolling 192-slot window. A separate
05:00:15 read confirms run 69265 started with one successful batch and has until
06:00. That new hour is still running, not a complete sweep. Older aged-out gaps
remain in their preserved incident records.

All six schedules and three regional routes are active. Retention through 04:50
returned HTTP 200; eligible raw objects, overdue metadata hours, deferred hours
and local daily-history backlog are zero in the 04:59 snapshot. Local cleanup
succeeded at 04:17. Archive accounting is 747,158,743 / 900,000,000 bytes; Storage
totals 751,433,691 bytes. No new raw read-back was needed after the three-region
02:59:55 audit; this does not claim a fresh object audit for run 69205. City research
remains complete and the research/evaluation protections are unchanged.

Full status and all three small supplemental reads succeeded. The compact index
remains 28,319,744 bytes, valid/ready with four keys and no INCLUDE. PostgreSQL
still reports its 01:13:20 start, 96 MiB shared buffers and no pending restart;
no lock wait or idle transaction appeared in the snapshots. An advancing
62.491-second interval ending 05:00:45 measured 293,609,472 bytes swap-in,
412,790,784 bytes swap-out, 39,674 major faults and 24.69% CPU I/O wait, with no
OOM kills and 145,272,832 bytes available RAM. Known resource pressure persists.

`followup-0459.json` records passed service assertions and the separate new-hour
read. No new operational gap or service change requires a notification. Zero
operator repairs this check; one for the incident. The previously reported
December 2 database-size quota warning remains unchanged; billing was untouched.

## 06:03 UTC: hourly service remains operational

Run 69265 completed 72/72 batches at 05:14:34.375531 with 141,660 fixed-inventory
observations, 92,659 priced stations, correct 59 / 9 / 4 regional routing and
72 requests / 141,660 lookups. All ten Trends scopes published it at
05:15:00.509939; latest and retained complete-run projection gaps are zero.
Run 69325 for 06:00 had 16 successful batches at status capture and 17 requests /
32,213 lookups in the later budget read, within limits and its 07:00 deadline.
Rolling 192-slot reconciliation remains 190 complete, one known midnight partial
hour, one current running hour and no expired absent/running slots. Older gaps
remain documented; no new gaps were inferred.

All six schedules and three regional routes remain active. The previous transient
cooldown expired at 04:08:34 with no newer upstream denial in the returned recent
events. National retention at 06:00 returned HTTP 200, removing 72 operational
objects and one metadata hour, detaching 29 covered references. Eligible raw,
overdue metadata, deferred hours and local daily-history backlog are all zero.
The 05:17 local cleanup succeeded. Archive accounting is 744,313,700 / 900,000,000
bytes; Storage is 748,588,648 bytes. The last actual regional archive integrity
sample remains the 02:59:55 audit; no new object audit is claimed this check.
City research stays complete; research/evaluation protections remain unchanged.

Full status and three small supplemental reads succeeded. The compact index is
unchanged at 28,319,744 bytes, valid/ready and without INCLUDE. PostgreSQL still
has the 01:13:20 start and 96 MiB shared buffers, with no pending restart. One
DataFileRead wait appeared, with no lock wait or idle transaction. A measured
63.626-second interval ending 06:04:21 recorded 422,596,608 bytes swap-in,
579,616,768 bytes swap-out, 62,484 major faults and 34.68% CPU I/O wait, zero OOM
kills and 213,995,520 bytes available RAM. Known resource pressure persists despite
successful service checks; no permanent resource fix is claimed.

Service assertions passed in `followup-0603.json`. No new repair, collection
replay, billing/configuration change or phone interaction. Incident repair count
remains one. The previously reported December 2 quota warning is unchanged.

## 06:58 UTC: complete sweep and no new operational gap

Run 69325 completed 72/72 batches at 06:16:46.373049 with 141,660 fixed-inventory
observations, 92,684 priced stations and correct 59 / 9 / 4 routing. It used
74 requests / 145,660 lookups within unchanged limits. A transient 503 cooldown
expired at 06:09:27 without intervention. All ten cache scopes published the
complete run at 06:17:00.276484. Latest and retained complete-run projection gaps
are zero. The rolling 192-slot snapshot contains 191 complete hours and the
unchanged midnight partial hour, with no absent or expired-running slots.
Historical gaps outside retained metadata remain in their incident records.

All six schedules and three routes are active. National retention through 06:50
returned HTTP 200; eligible raw objects, overdue metadata hours, deferred hours
and local daily-history backlog are zero. The 06:17 local cleanup succeeded.
Archive accounting is 747,137,069 / 900,000,000 bytes and Storage is 751,412,017
bytes. Last actual regional archive sampling remains the successful 02:59:55
audit; no fresh object audit is claimed for run 69325. City research is complete,
and research/evaluation protections, raw retention and billing remain unchanged.

Full status and all supplemental reads succeeded. The compact index remains
28,319,744 bytes, valid/ready with four keys and no INCLUDE; PostgreSQL still
reports its 01:13:20 start and 96 MiB shared buffers. No lock wait or idle
transaction appeared. An advancing 60.66-second interval ending 06:59:47 recorded
88,002,560 bytes swap-in, 94,474,240 bytes swap-out, 12,656 major faults and 8.06%
CPU I/O wait, with no OOM kills and 188,100,608 bytes available RAM. This is a
lower-pressure interval, not proof of permanent resource recovery.

`followup-0658.json` contains passed service assertions. No new gap, operator
repair, provider collection/replay, configuration change or phone interaction.
The existing December 2 quota warning is unchanged. Incident repair count is one.

A separate 07:00:22 protected read confirms run 69385 began on schedule, with one
successful batch and another in progress. Its deadline is 08:00; it is not yet a
complete sweep. This later observation is stored separately from the 06:58 full
status snapshot.
