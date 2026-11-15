# November 14 database access degradation

**Current outcome, 11:48 UTC:** The first full post-restart sweep and its complete
Trends publication, app API delivery, regional immutable archive read-back and
scheduled retention are verified. No new expired hourly gaps were found. One
recovery attempt was used; resource pressure under load remains a limitation.

At 10:45 UTC, the protected status read failed at database connection setup. Its
independent host metrics and bounded fallback database reads also timed out.
A four-run SQL read, direct authenticated REST read, and activity/index-size query
failed within their client bounds. A separate resource attempt returned HTTP 504.
Unavailable run data does not establish missing hours.

The signed-in dashboard reported Unhealthy, severe memory commitment (1.5 GB),
406.31 MB memory usage, and an 86.30% CPU chart label. It warned that the disk I/O
budget was nearly depleted, with a 5 MB/s baseline after depletion. I/O, connection
and disk usage charts failed to load. These dashboard labels are not independent
interval measurements and do not establish swap rates or precise root cause.
The December 2 quota-grace notice is not an active restriction.

Logs showed national dispatch, Trends publication and projection-repair cron
startup timeouts, statement cancellations, SSL EOF/resets, 13–20 second role-object
lock waits and a 14-second pg_settings metadata read. No identified application
query was cancelled. Current index size could not be read, so recurrence of the
old INCLUDE-index defect is not inferred.

At approximately 10:48 UTC, the authorized full-project restart was accepted and
the UI showed Restarting. This is recovery attempt one for this recurrence;
the separate November 10 incident had verified recovery after three attempts.
The full restart follows that previously verified recovery path. No billing,
routing, budget, raw-price or research change was made; no provider collection
was invoked. The city campaign remains closed. Restart acceptance is not recovery.

Recovery verification is pending. The monitor will check actual scheduled runs,
current and absent expired slots, cooldowns, complete cache publication, projection
and retention backlogs, host pressure, compact-index size and immutable archive
read-back. Operational observations cover the fixed catalog and are not verified
pump truth.

## 10:53–10:55 UTC: access, publication and archive verification

The dashboard returned Healthy. A protected read confirmed PostgreSQL restarted
at 10:52:34.105078 UTC, retaining shared_buffers=96MB. The 10:00 run 61015 had
already completed at 10:14:35, before this outage: 72/72 batches, 141,660 fixed
inventory observations, 93,327 stations with reported prices, all three routes
correct (59/9/4 batches). This pre-restart collection is not attributed to repair.
The retained eight-day reconciliation has 177 complete and 15 previously known
partial slots, zero expired absent/running slots and no current absent slot.
No new collection gap was found. The oldest retained operational run is November
6 10:00; intentionally expired older metadata cannot support a fresh all-time gap
recount. Previously reported older operational gaps remain in saved incidents.

All six schedules remain active. Post-restart scheduled dispatch and projection
jobs succeeded; the publisher finished at 10:53:28 and published the complete
10:00 run across all ten scopes. All ten fuel/E85 app API combinations returned
HTTP 200, source=national-cache, scanId=61015 and 152 history points with no history
error. Latest-run projection backlog is zero. This is API delivery, not phone UI
verification. No phone app was opened.

One immutable object from each fixed region in the complete 10:00 run passed
Storage read-back, SHA-256/byte size, exact station-ID, schema, time-window and
provenance checks. All 72 archive references are undeleted. This is three-object
integrity sampling; database manifests separately establish full-run coverage.

Archive accounting is 749,480,528 of 900,000,000 bytes, with zero eligible raw
objects or overdue operational metadata at the read. The last retention response
before restart was HTTP 200 at 10:10. A post-restart scheduled retention execution
and new-hour collection remain to be verified.

The deduplicated retention index remains valid/ready and retains the four-key
structure without INCLUDE. Its size has grown to 21,626,880 bytes (9,216,000 on
November 10, 2,039,808 immediately after initial rebuild). This is observed growth,
not proof of the old index-definition defect recurring or an exact bloat ratio.
The table's post-restart autovacuum finished at 10:53:43 with zero estimated dead
rows. The price-order and lookup primary indexes are valid/ready at 40,083,456 and
26,787,840 bytes. No speculative reindex or diagnostic-extension install occurred.

A 60.5-second resource interval ending 10:54:14 measured 689 MB swap-in, 691 MB
swap-out and 61.48% CPU I/O wait during initial recovery. A later 60.4-second
interval ending 10:55:43 measured 35 MB swap-in, 63 MB swap-out, 2.19% I/O wait,
96.81% CPU idle and 243 MB available RAM. Both counters advanced and no new OOM
kills appeared. Pressure eased, but the restart does not establish a permanent
resource/capacity fix. No billing or budget change is authorized or performed.

The broader retained-history projection check found three missing derived batches
from November 10 15:00 run 55572, the same previously documented older gap. Their
raw objects expired under the authorized 48-hour operational retention on November
12 at 16:00, and no active repair records exist. They cannot be reconstructed from
those expired objects; no provider replay or invented replacement was attempted.
This does not affect the complete latest published sweep. Latest-run zero backlog
must not be described as zero missing derived data across all retained history.
The city campaign is confirmed complete with its original October 7 end time.
The 09:00 and 10:00 sweeps each used exactly 72 requests / 141,660 lookups, below
92 / 161,660 limits; the historical 503 cooldown expired at 08:06:38 naturally.

## 11:04 UTC: scheduled collection and retention resumed

The first post-restart scheduled sweep, 11:00 run 61048, began automatically.
By 11:03:34 all three fixed routes had succeeded batches with zero routing
mismatches. The next full status showed 18/72 successful batches and 33,960 fixed
inventory observations. This is verified scheduled progress, not a completed
sweep; its deadline is 12:00 UTC. A fresh immutable batch from each region in this
new run passed actual Storage read-back, SHA-256/size, exact ID, schema,
time-window and provenance verification. Their observations all postdate restart.
No monitor-triggered provider request, collection replay or re-enable was used.

Scheduled retention returned HTTP 200 at 11:00, removing 72 eligible operational
raw objects and one old metadata hour, detaching 13 references, with no deferred
hours and zero provider requests. Final accounting was 746,799,348 / 900,000,000
bytes; zero eligible raw objects and zero overdue metadata remain. The normal
48-hour/eight-day retention policy and research/cache protections were unchanged.
All six required schedules are active, including the main dispatcher and watchdog.

The retained eight-day slot check is 192 expected: 176 complete, 15 previously
known partial, one current running, zero expired absent/running and zero current
absent slots. No new incomplete operational hour is established by this incident.
The latest complete cache remains run 61015 (10:00), correctly published in all
ten scopes with no missing latest-run projections. A pending projection observed
inside the in-progress 11:00 sweep is not a complete-run cache defect; normal
projection recovery remains scheduled. The three older unavailable projection
batches described above remain distinct from current serving health.

The active-collection resource interval ending 11:02:19 measured 385 MB swap-in,
292 MB swap-out, 27.21% CPU I/O wait, 128 MB available RAM and no new OOM kills.
Thus resource pressure recurs under collection even after service recovery.
This run verifies restored access, scheduled progress on all routes, complete-cache
API delivery, scheduled retention and new archive integrity. It does not claim a
permanent capacity/root-cause fix or completion of the 11:00 sweep. Exactly one
recovery attempt was used. No speculative schema/index change or billing change
was made. The initial dashboard evidence, before/after protected reads, three
resource intervals and both regional archive samples are preserved here.

Validation: the monitoring-read test passed; JSON assertions verified schedules,
no new expired gaps, latest complete-cache alignment, archive budget, retention
backlog and three post-restart immutable archive samples. No app/device UI was
opened. National station coverage remains relative to the fixed 141,660-ID catalog;
these reported prices are not verified pump truth.

## 11:48 UTC: full scheduled sweep and cache verified

Run 61048 completed at 11:14:33.952343 UTC with 72/72 batches, 141,660 fixed-catalog
observations, 93,251 stations with reported prices and zero missed batches. The
59/9/4 allocations all completed on their correct fixed regional routes. It used
72 requests and 141,660 lookups, within unchanged limits of 92 and 161,660.
The expired 08:06:38 cooldown was not cleared or overridden.

All ten Trends scopes published this run at 11:15:00.223751. The latest complete
sweep has zero missing projections. All ten fuel/E85 API combinations returned
HTTP 200, source=national-cache, scanId=61048 and no history error. A fresh sample
of one immutable object per region, selected after sweep completion, passed
actual Storage read-back and all hash, size, exact-ID, schema, time-window and
provenance checks. This samples three objects, while database manifests establish
72-batch coverage; neither establishes verified pump truth.

The retained eight-day window has 177 complete and the same 15 historical partial
hours, zero expired absent/running slots and zero current absent slots. No new
operational hour gap was found. Previously expired metadata is not counted as
absent collection. The three previously recorded November 10 derived gaps remain
unchanged and separate from the latest complete cache.

All six required schedules remain active. Retention returned HTTP 200 at 11:40
with no deferrals, and there are zero eligible raw objects or overdue metadata
hours. Archive usage is 749,484,117 / 900,000,000 bytes. The compact reference
index is valid/ready at 21,708,800 bytes; its continued growth is retained as a
monitoring signal, without claiming an exact bloat ratio or recurrence of the
removed INCLUDE definition. No further restart, index operation, schema change,
re-enable, provider collection, raw-price rewrite or billing change was performed.

A 60.336-second resource interval ending 11:48:19 had advancing counters, 97.32%
CPU idle, 1.71% I/O wait, 21.5 MB swap-in, 19.8 MB swap-out, 143.9 MB available RAM
and zero new OOM kills. This quieter interval does not erase the measured pressure
during collection or prove a permanent capacity fix. Recovery-attempt count stays
one. JSON assertions checked complete regional coverage, budgets, cache alignment,
absence of new expired gaps, active schedules, retention capacity and archive
integrity. Evidence is in complete-sweep-*.json and resource-1148.json.

## 19:10 UTC: continued scheduled service

The full protected status query and supplemental read succeeded. The 18:00 run
61468 completed 72/72 batches on the correct 59/9/4 routes, using 73 requests and
143,660 lookups within the 92/161,660 budgets. Its ten-scope Trends cache published
at 18:18 UTC with zero missing latest-run projections. The 19:00 run 61528 is
in progress (47/72 at the status snapshot) and has until 20:00 UTC; it is not an
expired gap. The retained eight-day window has 176 complete, 15 known partial,
one current running and zero expired absent/running slots. Expired metadata before
that window is not counted as absent collection; historical gaps remain recorded.
The three known November 10 projection gaps remain separate from current cache health.

All six schedules are active. Retention returned HTTP 200 at 19:00, removed 72
eligible operational objects and one metadata hour, and reported no deferrals.
No eligible raw objects or overdue metadata remain. Archive accounting is
748,064,220 / 900,000,000 bytes. The city campaign remains complete. Continuous
mode, the October 7 operational start, 48-hour raw retention and eight-day metadata
retention are unchanged. The shared transient cooldown expired at 18:05:47 UTC;
no cooldown was overridden. Deferred serving writes have not left a latest-complete
projection backlog.

The compact reference index is valid/ready at 22,675,456 bytes, up from 21,708,800
at 11:48; this is growth, not a measured bloat ratio or proof of the old INCLUDE
defect recurring. Host metrics show 155,103,232 bytes available RAM, 372,781,056
bytes occupied swap and load averages 0.31/0.37/0.24. The activity snapshot has no
lock waits. Existing resource pressure remains a monitoring concern, but these
successful reads and current collection do not justify another restart or index
operation. No repair was performed; incident attempt count remains one. Recovery
archive integrity was already verified at 11:48; no new recovery occurred here.

`followup-1910.json` records the status, host counters, bounded supplemental read
and passing consistency assertions. No provider collection, app launch, raw-price
write, billing change or research modification was triggered. Coverage is relative
to the fixed 141,660-ID inventory; reported prices are not verified pump truth.

## 20:13 UTC: continued collection and publication

The 19:00 sweep 61528 completed all 72 batches on its fixed 59/9/4 routes, with
141,660 catalog observations and 91,636 reported-price stations. Its 73 requests
and 143,660 lookups are within budget. Ten Trends scopes published at 19:16 UTC,
with no latest-complete projection backlog. Run 61588 (20:00) was 52/72 at the
status snapshot and remains within its 21:00 deadline. The retained slot counts
are unchanged: 176 complete, 15 known partial, one current running, no expired
absent/running slots. Older metadata expiry is not counted as failed collection.
The three previously documented November 10 projection gaps remain unchanged.

All six schedules are active; retention returned HTTP 200 at 20:00 and 20:10.
There are no eligible raw objects or overdue metadata hours. Archive usage is
748,331,545 / 900,000,000 bytes. The transient shared cooldown expired naturally
at 20:09:14; continuous service is enabled and the city campaign remains complete.
No pause, cooldown, budget or retention protection was modified.

The compact retention index is valid/ready at 22,839,296 bytes (+163,840 since the
previous check); index size alone does not establish bloat. Host metrics show
149,737,472 bytes available RAM, 477,884,416 bytes occupied swap and load averages
0.95/0.78/0.47. No lock waits appear in the activity snapshot. Full and supplemental
reads succeeded; continuing swap use remains a known concern without a new
service failure or evidence justifying a speculative repair. No additional repair
attempt, provider collection, app launch or archive rewrite occurred. The prior
recovery archive read-back remains the integrity evidence; this is continued
scheduled operation, not a new recovery. Fixed-inventory coverage is not verified
pump truth. `followup-2013.json` preserves the passing checks and host counters.

## 21:12 UTC: no new expired gaps

Scheduled run 61588 (20:00) completed 72/72 batches on the correct 59/9/4 routes,
with 141,660 catalog observations and 91,506 reported-price stations. Its 75
requests and 147,660 lookups stayed within 92/161,660. The complete cache published
all ten scopes at 20:19 with zero missing latest-run projections. The 21:00 run
61648 was 58/72 at the status snapshot and has until 22:00. Retained operational
slots remain 176 complete, 15 known partial and one current running, with zero
expired absent/running slots. Metadata outside retention is not a new collection
gap. The three old November 10 projection gaps are unchanged.

All six schedules are active. Retention returned HTTP 200 at 21:00 and 21:10,
with zero eligible raw objects or overdue metadata. Archive accounting is
748,613,285 / 900,000,000 bytes. The shared cooldown expired naturally at 20:14:25;
the city campaign is still complete and continuous national mode remains enabled.
The compact reference index is valid/ready at 22,994,944 bytes, up 155,648 bytes
since 20:13. This size observation does not measure bloat. Host available RAM is
108,785,664 bytes, occupied swap 543,838,208 bytes and loads 0.95/0.79/0.51. Swap
occupancy increased, so memory pressure remains a concern; protected reads and
scheduled service succeeded and no lock waits were observed. There is no new
failure supporting a speculative restart, billing change or index operation.

Evidence and passing consistency checks are in `followup-2112.json`. Zero repair
attempts this check; the incident total remains one. No provider requests, app
launch, raw-price overwrite or research change was triggered. The prior recovery
archive sample remains verified; no new recovery occurred. Coverage is relative
to the fixed inventory and is not verified pump truth.

## 22:14 UTC: scheduled service remains current

Run 61648 (21:00) completed 72/72 batches on the correct 59/9/4 routes, with
141,660 catalog observations, 91,284 reported-price stations and 72 requests /
141,660 lookups. Ten cache scopes published at 21:15 with zero latest-run
projection gaps. Run 61708 (22:00) was 51/72 at the status snapshot, progressing
within its 23:00 deadline. Retained slot counts remain 176 complete, 15 previously
known partial, one current running and zero expired absent/running. The three
old November 10 projection gaps are unchanged; expired metadata is not treated
as missing collection.

All six schedules, budgets and fixed routes passed. Retention returned HTTP 200
at 22:00 and 22:10, with zero raw or metadata backlog. Archive usage is
748,222,575 / 900,000,000 bytes. The shared cooldown expired naturally at 22:05:24;
continuous mode and the completed city campaign remain as intended. The compact
reference index is valid/ready at 23,093,248 bytes (+98,304 since 21:12); size growth
alone is not a bloat measurement. Available RAM is 171,982,848 bytes, occupied swap
516,861,952 bytes and loads 1.21/1.00/0.58. Both protected reads succeeded; no lock
waits were observed. Known memory pressure continues to be monitored.

`followup-2214.json` records passing checks and host counters. There was no new
recovery, repair, provider collection, app launch, raw rewrite or research change.
The incident attempt count remains one and the previously verified recovery
archive sample remains the read-back evidence. Coverage is relative to the fixed
inventory, not verified pump truth. No user action is needed.

## 23:14 UTC: unchanged service health

Run 61708 (22:00) completed 72/72 batches on the three fixed routes, with
141,660 catalog observations and 91,095 reported-price stations. Its 75 requests /
147,660 lookups are within budget. All ten cache scopes published at 22:21 with
zero latest-run projection backlog. Run 61768 (23:00) was 63/72 at the status
snapshot and has until midnight UTC. Retained slots remain 176 complete, 15 known
partial and one current running, with zero expired absent/running. The three old
November 10 projection gaps remain unchanged; expired metadata is not a new gap.

All six schedules remain active. Retention returned HTTP 200 at 23:00 and 23:10;
raw and metadata backlogs are zero. Archive usage is 748,813,934 / 900,000,000 bytes.
The compact index is valid/ready at 23,224,320 bytes (+131,072); size alone does
not prove bloat. Host available RAM is 169,119,744 bytes, occupied swap 617,308,160
bytes and loads 1.09/0.82/0.50. Swap occupancy rose, but protected reads succeeded,
no lock waits appeared, and scheduled collection remains current. Memory pressure
continues to be monitored without a speculative repair.

`followup-2314.json` preserves passing consistency checks. The shared cooldown
remains expired and city collection remains complete. No new recovery or repair
occurred (incident attempts remain one); the prior recovery archive read-back
remains verified. No provider request, app launch, raw rewrite, billing or research
change was triggered. Fixed-inventory observations are not verified pump truth.

## November 15, 00:14 UTC: collection continues across midnight

Run 61768 (November 14, 23:00) completed all 72 batches on the correct three
routes, with 141,660 catalog observations and 90,857 reported-price stations.
Its 73 requests / 143,660 lookups are within budget. All ten Trends scopes
published at 23:16 with zero latest-run projection backlog. Run 61828 (00:00)
was 69/72 at the status snapshot and remains within its 01:00 deadline. The
retained window is unchanged: 176 complete, 15 known partial, one current running,
zero expired absent/running. The three old projection gaps remain unchanged;
metadata expiry outside the retained window is not counted as absent collection.

All six schedules remain active. National retention returned HTTP 200 at 00:00
and 00:10, with zero raw or operational metadata backlog. Archive accounting is
749,083,937 / 900,000,000 bytes. UTC day rollover newly puts 90,336 local-history
rows past their date threshold; the next scheduled local-history cleanup is
00:17, so this snapshot does not establish a missed retention execution.
The compact reference index is valid/ready at 23,347,200 bytes (+122,880).
Index size alone is not evidence of bloat. Available RAM is 114,196,480 bytes,
occupied swap 535,171,072 bytes and loads 0.78/0.64/0.42. Activity includes data
file I/O waits but no lock waits; both protected reads succeeded. Known memory
pressure remains under observation without a new outage or speculative repair.

`followup-1115-0014.json` preserves the passing consistency checks. The shared
cooldown remains expired and city collection remains complete. Zero new repairs
(incident total remains one), provider requests, app launches, raw overwrites,
billing changes or research changes. No new recovery occurred; the previous
recovery archive read-back remains verified. Coverage is fixed-inventory coverage,
not verified pump truth.

## November 15, 01:13 UTC: scheduled service and bounded cleanup

Run 61828 (00:00) completed 72/72 batches on the correct 59/9/4 routes, with
141,660 catalog observations, 90,403 reported-price stations and 72 requests /
141,660 lookups. All ten Trends scopes published at 00:15 with no latest-run
projection gaps. Run 61888 (01:00) was 63/72 at the snapshot, within its 02:00
deadline. Retained counts remain 176 complete, 15 known partial and one current
running, with zero expired absent/running. The three old November 10 projection
gaps remain unchanged; expired metadata is not inferred to be absent collection.

All six schedules are active. National retention returned HTTP 200 at 01:00 and
01:10; its temporary one-hour metadata deferral drained by 01:10. Eligible raw
objects and overdue operational metadata are both zero. Archive accounting is
748,716,863 / 900,000,000 bytes. Local-history rows past the date threshold fell
from 90,336 to 14,444. A targeted protected read confirms the 00:17 local cleanup
succeeded and the live function retains its 20,000-row, SKIP LOCKED cap. The next
cleanup is 01:17; this remaining bounded backlog is not a failed schedule and no
manual deletion was performed. The observed decline is not attributed solely to
the capped function.

The compact index is valid/ready at 23,453,696 bytes (+106,496); size alone does
not establish bloat. Available RAM is 142,184,448 bytes, occupied swap 557,043,712
bytes and loads 0.98/0.91/0.62. Protected reads succeeded with no observed lock
waits. Known resource pressure continues to be monitored. The shared cooldown is
expired; the city campaign remains complete. No new repair or recovery occurred
(incident attempts remain one), and previous recovery archive read-back remains
verified. No provider request, phone-app launch, raw rewrite, billing or research
change was triggered. `followup-1115-0113.json` records passing checks and cleanup
evidence. Fixed-inventory observations are not verified pump truth.

## November 15, 02:11 UTC: local-history backlog drained

Run 61888 (01:00) completed 72/72 batches on the correct three routes, with
141,660 catalog observations and 90,322 reported-price stations. Its 72 requests /
141,660 lookups are within budget. All ten cache scopes published at 01:15 with
zero latest-run projection gaps. Run 61948 (02:00) was 52/72 at the status snapshot
and has until 03:00. Retained operational counts remain 176 complete, 15 known
partial, one current running and zero expired absent/running. The three old
November 10 projection gaps remain unchanged; metadata expiry is not a new gap.

The previously pending local-history cleanup has drained: zero rows remain past
the date threshold, and oldest day is November 8. All six schedules are active.
National retention returned HTTP 200 at 02:00 and 02:10, with zero raw or metadata
backlog. Archive accounting is 748,097,828 / 900,000,000 bytes. The compact index
is valid/ready at 23,527,424 bytes (+73,728); no bloat ratio is inferred from size.
Available RAM is 111,742,976 bytes, occupied swap 538,099,712 bytes and loads
0.66/0.69/0.41. Both protected reads succeeded; a data-file write wait was observed,
with no lock waits. Known memory pressure remains under observation.

`followup-1115-0211.json` records passing checks. The shared cooldown is expired
and the city campaign remains complete. Cleanup completion was automatic; no new
repair or recovery occurred (incident attempts remain one). The previous recovery
archive read-back remains verified. No provider collection, app launch, raw rewrite,
billing or research change was triggered. Fixed-inventory observations are not
verified pump truth.

## November 15, 03:18 UTC: current hour already complete

Runs 61948 (02:00) and 62008 (03:00) both completed all 72 batches on the correct
59/9/4 regional routes. Run 62008 has 141,660 catalog observations and 90,587
reported-price stations; 73 requests / 143,407 lookups are within budget. Its ten
cache scopes published at 03:17 with zero latest-run projection gaps. Retained
slots are now 177 complete and the same 15 known partial, with zero current or
expired absent/running slots. The three old November 10 projection gaps remain
unchanged; expired metadata outside the window is not treated as a collection gap.

All six schedules are active; national retention returned HTTP 200 at 03:00 and
03:10. Raw, operational metadata and local-history backlogs are all zero. Archive
accounting is 749,059,230 / 900,000,000 bytes. A transient upstream HTTP 503 cooldown
expired naturally at 03:03:41 and scheduled collection completed without intervention.
The compact index is valid/ready at 23,781,376 bytes (+253,952), without a measured
bloat ratio. Available RAM is 152,285,184 bytes, occupied swap 383,594,496 bytes and
loads 0.32/0.56/0.47. Both protected reads succeeded with no lock waits. Known
resource pressure remains monitored despite this quieter snapshot.

`followup-1115-0318.json` records passing checks. The city campaign remains complete.
No new incident repair or recovery occurred (repair attempts remain one); routine
transient retry completion is automatic, not an effect of a monitor repair. Prior
recovery archive read-back remains verified. No provider collection, app launch,
raw rewrite, billing or research change was triggered. Fixed-inventory observations
are not verified pump truth.

## November 15, 04:16 UTC: current collection within deadline

Run 62068 (04:00) was 68/72 at the status snapshot, progressing on the fixed routes
within its 05:00 deadline. The supplemental count was 70 requests / 137,960 lookups,
within budget. The latest complete run remains 62008 (03:00): all 72 batches,
141,660 catalog observations, ten cache scopes published at 03:17 and zero
latest-run projection gaps. Retained slots are 176 complete, 15 known partial and
one current running, with zero expired absent/running. The change from 177 complete
reflects the rolling window and current running slot, not a new gap. The three old
November 10 projection gaps remain unchanged; expired metadata is not inferred to
be absent collection.

All six schedules remain active. National retention returned HTTP 200 at 04:00
and 04:10; raw, metadata and local-history backlogs are zero. Archive accounting
is 748,808,830 / 900,000,000 bytes. The transient HTTP 502 cooldown expired
naturally at 04:13:02 and collection progressed without monitor intervention.
The compact index is valid/ready at 23,912,448 bytes (+131,072); size alone does
not measure bloat. Available RAM is 121,044,992 bytes, occupied swap 505,864,192
bytes and loads 0.69/0.58/0.43. Protected reads succeeded with no observed lock
waits; known memory pressure remains monitored.

`followup-1115-0416.json` records passing checks. City collection remains complete.
No repair or new incident recovery occurred (incident attempts remain one); prior
recovery archive read-back remains verified. No provider request, app launch,
raw overwrite, billing or research change was triggered. Fixed-inventory price
observations are not verified pump truth.

## November 15, 05:15 UTC: completed sweep and next-tick publication

Runs 62068 (04:00) and 62128 (05:00) completed all 72 batches on their fixed
59/9/4 routes. Run 62128 completed at 05:14:37, with 141,660 catalog observations,
90,635 reported-price stations and 72 requests / 141,660 lookups. The initial
status snapshot briefly showed the previous cache after completion; a small
protected read verified the normal 05:15 scheduled publication of all ten scopes
to run 62128. No manual publication or repair was needed. Latest-run projection
backlog is zero. Retained slots are 177 complete and 15 known partial, with zero
current or expired absent/running; the three old November 10 projection gaps are
unchanged. Expired metadata is not counted as a collection gap.

All six schedules remain active. National retention returned HTTP 200 at 05:00
and 05:10; raw, metadata and local-history backlogs are zero. Archive usage is
748,935,579 / 900,000,000 bytes. The compact index is valid/ready at 24,002,560 bytes
(+90,112); size alone does not quantify bloat. Available RAM is 137,302,016 bytes,
occupied swap 578,076,672 bytes and loads 1.01/0.94/0.64. Full and supplemental
protected reads succeeded, with no observed lock waits. Resource pressure remains
monitored. The shared cooldown is expired and the city campaign remains complete.

`followup-1115-0515.json` preserves the initial snapshot, next-tick cache read and
passing checks. No new repair or incident recovery occurred (attempt count remains
one), and previous recovery archive read-back remains verified. No provider
collection, app launch, raw rewrite, billing or research change was triggered.
Fixed-inventory observations are not verified pump truth.

## November 15, 06:20 UTC: complete current sweep and cache

Run 62188 (06:00) completed all 72 batches at 06:15:46 on the fixed 59/9/4 routes,
with 141,660 catalog observations and 90,593 reported-price stations. The 05:00
and 06:00 sweeps each used 72 requests / 141,660 lookups, within budget. All ten
cache scopes published run 62188 at 06:17 with zero latest-run projection gaps.
Retained slots remain 177 complete and 15 known partial, with zero current or
expired absent/running. The three old November 10 projection gaps remain unchanged;
metadata expiry outside the retained window is not counted as absent collection.

All six schedules remain active; national retention returned HTTP 200 at 06:00
and 06:10. Raw, operational metadata and local-history backlogs are zero. Archive
accounting is 748,875,920 / 900,000,000 bytes. The compact index is valid/ready at
24,100,864 bytes (+98,304); size is not a bloat measurement. Available RAM is
191,512,576 bytes, occupied swap 420,200,448 bytes and loads 0.43/0.48/0.47. Both
protected reads succeeded with no observed lock waits. This quieter snapshot does
not establish a permanent resolution of known resource pressure.

`followup-1115-0620.json` records passing checks. Shared cooldown remains expired
and city collection complete. No new repair or incident recovery occurred
(attempt count remains one); prior recovery archive read-back remains verified.
No provider collection, app launch, raw rewrite, billing or research change was
triggered. Coverage is relative to the fixed inventory, not verified pump truth.

## November 15, 07:21 UTC: continued complete hourly service

Run 62248 (07:00) completed 72/72 batches at 07:14:35 on the correct fixed
59/9/4 routes, with 141,660 catalog observations and 90,555 reported-price stations.
The 06:00 and 07:00 sweeps each used 72 requests / 141,660 lookups within budget.
All ten cache scopes published run 62248 at 07:15 with zero latest-run projection
gaps. Retained slots remain 177 complete and 15 known partial, with zero current
or expired absent/running. The three old November 10 projection gaps are unchanged;
expired metadata outside the window is not counted as absent collection.

All six schedules are active. National retention returned HTTP 200 at 07:10 and
07:20; raw, operational metadata and local-history backlogs are zero. Archive
accounting is 748,817,432 / 900,000,000 bytes. The compact index is valid/ready at
24,158,208 bytes (+57,344); index size alone is not a bloat measurement. Available
RAM is 174,403,584 bytes, occupied swap 494,186,496 bytes and loads 0.55/0.31/0.30.
Both protected reads succeeded with no observed lock waits. Known resource pressure
remains monitored. The shared cooldown is expired and city collection complete.

`followup-1115-0721.json` records passing checks. No new repair or incident recovery
occurred (attempt count remains one); prior recovery archive read-back remains
verified. No provider collection, app launch, raw rewrite, billing or research
change was triggered. Coverage is fixed-inventory coverage, not verified pump truth.

## November 15, 08:18 UTC: current sweep and cache verified

Run 62308 (08:00) completed 72/72 batches on the fixed 59/9/4 routes at 08:15:36,
with 141,660 catalog observations and 90,549 reported-price stations. Its 73
requests / 143,660 lookups stayed within budget. All ten cache scopes published
at 08:16 with zero latest-run projection gaps. Retained counts are 177 complete
and 15 known partial, with zero current or expired absent/running. The three old
November 10 projection gaps are unchanged; expired metadata is not counted as a
new collection gap.

All six schedules remain active; retention returned HTTP 200 at 08:00 and 08:10.
Raw, metadata and local-history backlogs are zero. Archive accounting is
748,754,870 / 900,000,000 bytes. The transient HTTP 503 cooldown expired naturally
at 08:01:08 and scheduled collection completed without intervention. The compact
index is valid/ready at 24,240,128 bytes (+81,920), without a measured bloat ratio.
Available RAM is 133,849,088 bytes, occupied swap 428,081,152 bytes and loads
0.37/0.46/0.36. Protected reads succeeded with no lock waits; known resource
pressure remains monitored.

`followup-1115-0818.json` preserves passing checks. City collection remains
complete. No new repair or incident recovery occurred (attempt count remains one);
prior recovery archive read-back remains verified. No provider collection, app
launch, raw rewrite, billing or research change was triggered. Coverage remains
relative to the fixed inventory, not verified pump truth.

## November 15, 09:24 UTC: complete sweep, no new gaps

Run 62368 (09:00) completed all 72 batches at 09:14:39 on the correct fixed
59/9/4 routes, with 141,660 catalog observations and 90,529 reported-price stations.
Its 72 requests / 141,660 lookups stayed within budget. All ten cache scopes
published at 09:15 with zero latest-run projection gaps. Retained slots remain
177 complete and 15 known partial, with zero current or expired absent/running.
The three old November 10 projection gaps are unchanged; metadata expiry outside
the retained window is not counted as absent collection.

All six schedules are active; national retention returned HTTP 200 at 09:10 and
09:20. Raw, operational metadata and local-history backlogs are zero. Archive
accounting is 748,690,458 / 900,000,000 bytes. The compact index is valid/ready at
24,330,240 bytes (+90,112); no bloat ratio is inferred from size. Available RAM is
209,379,328 bytes, occupied swap 486,752,256 bytes and loads 0.29/0.19/0.24. Both
protected reads succeeded with no lock waits. Known memory pressure remains under
observation despite the quiet current interval. Shared cooldown is expired and
city collection remains complete.

`followup-1115-0924.json` records passing checks. No new repair or incident recovery
occurred (attempt count remains one); prior recovery archive read-back remains
verified. No provider collection, app launch, raw rewrite, billing or research
change was triggered. Coverage is relative to the fixed inventory, not verified
pump truth.

## November 15, 10:19 UTC: complete sweep after automatic transient retry

Run 62428 (10:00) completed all 72 batches at 10:16:04 on the fixed 59/9/4
regional routes, with 141,660 inventory observations and 90,493 reported-price
stations. A transient GraphQL failure received the shared 60-second cooldown,
which expired at 10:05:38; scheduled collection completed automatically using
73 requests / 143,660 lookups, within the 92 / 161,660 budgets. No override or
manual collection occurred. All ten cache scopes published at 10:17 with zero
latest-run projection gaps. The three old November 10 projection gaps remain.
Retained operational slots are 177 complete and 15 known partial, with zero
expired absent/running or current absent slots. Expired metadata is not inferred
to be missing collection.

All six schedules are active. Retention returned HTTP 200 at 10:00 and 10:10;
raw, metadata and local-history cleanup backlogs are zero. Accounted archive
usage is 748,624,067 / 900,000,000 bytes. City collection remains complete and
the original research window remains closed. The compact retention index is
valid/ready at 24,403,968 bytes (+73,728); size alone does not establish bloat.
Both protected reads succeeded without lock waits. Host available RAM is
152,006,656 bytes, occupied swap 404,336,640 bytes, loads 0.19/0.37/0.36.
Since the previous sample (about 55.7 minutes), swap-in/out counters increased
1,148,878 / 1,410,119 and disk busy counters increased 59.349 / 362.935 seconds
for nvme0n1 / nvme1n1. Memory pressure remains observable, but this interval has
successful scheduled service and bounded reads; no new repair is indicated.

`followup-1115-1019.json` contains passing assertions. Incident repair attempts
remain one; this check made none. Prior incident recovery archive read-back
remains verified; the routine transient retry is automatic behavior, not an
agent repair. No app launch, provider request, billing change, raw rewrite or
research mutation was performed. Coverage describes the fixed inventory and
reported prices, not verified pump truth.

## November 15, 11:27 UTC: complete sweep and current cache

Run 62488 (11:00) completed all 72 batches at 11:14:34 on the fixed 59/9/4
regional routes, observing 141,660 inventory stations and 90,410 reported-price
stations. Its 72 requests / 141,660 lookups stayed within budget. All ten cache
scopes published at 11:15 with zero latest-run projection gaps. Two saved
serving-client timeouts did not prevent complete collection or current cache
publication. The three old November 10 projection gaps remain unchanged.
Retained operational slots remain 177 complete and 15 known partial, with zero
expired absent/running and current absent slots; expired metadata outside this
window is not counted as missed collection.

All six schedules remain active; national retention returned HTTP 200 at 11:00,
11:10 and 11:20. Raw, metadata and local-history backlogs are zero. Accounted
archive usage is 748,561,261 / 900,000,000 bytes. Shared cooldown has expired;
city collection remains complete, and the research endpoint is unchanged.
The compact index is valid/ready at 24,477,696 bytes (+73,728); size alone does
not establish bloat. Both protected reads succeeded with no lock waits.
Available RAM is 148,463,616 bytes, occupied swap 382,554,112 bytes, and loads
are 0.15/0.13/0.19. Across about 68 minutes, swap-in/out counters increased
1,205,994 / 1,507,399; nvme0n1/nvme1n1 busy counters increased 75.011 / 391.160
seconds. Host memory pressure remains observable despite successful service;
no new repair is indicated by this check.

`followup-1115-1127.json` contains passing assertions. No repair or incident
recovery occurred; incident attempt count remains one and prior recovery
archive read-back remains verified. This check made no provider requests,
app launches, billing changes, raw rewrites or research mutations. Coverage is
relative to the fixed inventory, not verified pump truth.
