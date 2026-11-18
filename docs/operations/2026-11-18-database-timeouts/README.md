# November 18 database access degradation

**Outcome at 01:54 UTC:** One authorized full-project restart restored access and
scheduled collection. Run 66208 completed 72/72 batches before its deadline; all
ten Trends scopes and API combinations now serve it. Scheduled retention and
three regional immutable archive samples passed. No new expired hourly gaps.
Memory pressure and the local daily-history cleanup backlog remain limitations.

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

Initial sanitized evidence is in
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

## 01:40–01:42 UTC: retention restored, pressure persists

The 01:40 scheduled national retention cron succeeded and its worker returned
HTTP 200, status idle, zero eligible removals and zero deferred metadata hours.
This establishes post-restart scheduled retention recovery. Collection reached
50 successful batches at 01:41:34, within the 92-request/161,660-lookup budget.
A second advancing 61.9-second interval ended 01:41:15 with 319 MB swap-in,
335 MB swap-out, 22.38% CPU I/O wait, 153 MB available RAM and zero OOM kills.
The restart restored service but has not resolved the underlying resource
pressure. No additional repair attempt was made.

## 01:46–01:50 UTC: sweep complete; scheduled projection repair draining

Run 66208 completed all 72 batches at 01:46:14.854854, before its 02:00 deadline.
The 01:47 API check returned HTTP 200 and the previous complete run 66148, failing
the intended new-run assertion. Status confirmed six missing derived batches,
so full publication was not yet verified. The raw observations were successful;
this was a projection backlog, not missing collection.

The existing scheduled projection worker replays immutable Storage with hash,
size, provenance, time-window and schema validation, with no provider imports.
Its lease allows one batch per invocation. Missing derived batches decreased
from six at 01:47 to five at 01:48 and four at 01:49. Each completed replay had
one attempt and no error. This is automatic recovery after restart, not a
manual replay or additional operator repair attempt. Publication remains pending.

## 01:54 UTC: final verification and remaining limitations

The scheduled projection worker completed seven successful replays at 01:47
through 01:53, each on its first attempt. The latest-run derived backlog is zero.
The scheduled publisher published run 66208 across all ten scopes at
01:54:00.224636. Ten fuel/E85 API combinations returned HTTP 200, national-cache,
scanId 66208, 168 history points and no history error. The earlier stale-cache
assertion remains saved separately; these final checks passed.

The completed sweep observed all 141,660 fixed-inventory station records, with
92,807 containing reported prices. Routes were exactly 59 east, nine southwest
and four northwest batches, with zero wrong-region jobs. Requests were 72/92 and
lookups 141,660/161,660. These are provider observations, not verified pump truth
or proof of completeness beyond the fixed inventory.

The retained eight-day reconciliation has 192 expected hourly slots: 189 complete
and three previously known partial; zero expired absent/running or current
absent slots. Older intentionally expired operational metadata cannot be treated
as absent runs. Historical gaps remain in the earlier incident records.
The three old November 10 projection gaps are unchanged and distinct from the
now-zero latest-run backlog.

All six required schedules and three regional routes remain active. The 01:40
and 01:50 scheduled retention workers returned HTTP 200. Eligible operational raw
objects, overdue operational metadata and deferred metadata hours are zero.
Archive accounting is 743,570,747/900,000,000 bytes; Storage totals 747,845,695
bytes and database size is 2,084,736,147 bytes. Raw retention remains 48 hours,
metadata retention eight days, with original research/evaluation data and latest
published cache archive protected by the unchanged retention policy. The city
campaign remains complete. No manual provider collection, routing/cooldown/budget
bypass, billing change, raw overwrite or app launch occurred.

The 60.6-second interval after collection, ending 01:51:06, showed 56.8 MB swap-in,
38.2 MB swap-out, 4.21% CPU I/O wait, 133 MB available RAM and zero OOM kills.
Pressure eased after collection but remains measurable; this restart is not a
proven permanent capacity fix. The compact index is valid/ready at 27,828,224
bytes with no INCLUDE clause; growth/bloat ratio was not inferred from size alone.
Local daily history still has 13,746 rows past its day cutoff after the failed
01:17 prune. Its bounded hourly schedule is active, next due 02:17; this backlog
is reported separately from current national raw/metadata retention.

Validation: protected live SQL, independent advancing host-counter intervals,
actual Storage SHA-256/size/schema/ID/time/provenance read-back, ten API checks,
final invariant assertions, JSON parsing and git diff whitespace checks. No
application code or schema was changed, so no app/simulator test was run.
Exactly one operator recovery attempt was made. Scheduled resumption and the
seven automatic projection replays are distinguished from operator actions.
See final-status.json, final-extra.json, final-api.json, final-checks.json,
projection-progress.json, collection-progress.json and archive-sample.json.

## 02:27 UTC follow-up: first full post-restart sweep; cleanup cleared

Run 66249 (02:00) completed 72/72 batches at 02:16:14.914587 UTC, observing
141,660 fixed-inventory station records, 92,837 with reported prices. Regional
coverage is 59/9/4 with zero wrong-region jobs. A transient GraphQL response at
02:13:25 imposed the existing shared 60-second cooldown through 02:14:25; the
scheduled worker retried automatically. Requests were 73/92 and lookups
143,660/161,660. No denial was bypassed and no manual collection occurred.
All ten Trends scopes published run 66249 at 02:17:00.282439. Latest projection
backlog is zero; three old November 10 derived gaps remain unchanged.

The 02:17 local-history retention cron succeeded in 5.8 seconds. The previously
reported 13,746-row cleanup backlog is now zero; oldest daily history is November
11, with 702,496 rows occupying 318,349,312 bytes. This is automatic scheduled
cleanup following the earlier restart, not a new operator repair. National
retention returned HTTP 200 at 02:00, 02:10 and 02:20; the 02:00 pass removed 72
expired operational objects and one metadata hour. Eligible raw objects, overdue
metadata and deferred hours are zero. All six schedules and three routes remain
active; the city campaign remains complete.

Retained slot reconciliation: 192 expected, 189 complete, three previously known
partial, zero expired absent/running and zero current absent. No new operational
gap was found. Older expired metadata and original research gaps retain the
limitations and saved incident history described above.

At 02:28:22, actual Storage read-back passed SHA-256, byte size, exact station IDs,
schema, time-window and provenance checks for one object from each region in
run 66249. All three observations postdate the 01:33:51 restart. This samples
three immutable objects, not all 72, and does not verify pump truth or coverage
beyond the fixed inventory.

Archive accounting is 743,764,466/900,000,000 bytes, total Storage 748,039,414 bytes,
and database size 2,085,473,427 bytes. The compact retention index remains
27,828,224 bytes, valid/ready, with four keys and no INCLUDE. Independent metrics
succeeded: 122,855,424 bytes available RAM, 279,375,872 bytes occupied swap and
load averages 0.08/0.11/0.22. Cumulative paging counters still advance; this single
snapshot is not an interval rate or proof that underlying memory pressure is
permanently fixed. PostgreSQL start time is unchanged.

Protected reads, archive verification and final invariant assertions passed;
evidence is in followup-0227.json. Zero operator repair attempts this check;
incident total remains one. No code, billing, routing, budgets, research data,
raw prices or phone app were changed.

## 03:23 UTC follow-up: service remains current

Run 66309 (03:00) completed all 72 batches at 03:14:36.361982 UTC, with 141,660
fixed-inventory observations and 93,131 stations containing reported prices.
Regional batches remain 59/9/4 with zero wrong-region jobs. Requests were 72/92
and lookups 141,660/161,660. The previous transient shared cooldown expired at
02:14:25; no new upstream denial or operator re-enable occurred. All ten Trends
scopes published this complete run at 03:15:00.269431. Latest projection backlog
is zero; three old November 10 derived gaps remain unchanged.

Retained eight-day reconciliation remains 192 expected, 189 complete and three
previously known partial slots, with zero expired absent/running and zero current
absent slots. The original research window remains closed; expired older metadata
cannot be counted as newly missing hours. The city campaign remains complete.

All six schedules and three regional routes are active. National retention
returned HTTP 200 at 03:00, 03:10 and 03:20; the 03:00 pass removed 72 expired
operational objects and one metadata hour. No eligible raw objects, overdue
metadata or deferred hours remain. Local-history retention succeeded at 03:17;
its backlog remains zero, oldest day November 11, 704,408 rows and 318,349,312
bytes. Operational raw/metadata retention and protected research, evaluation and
latest-cache preservation policies are unchanged.

Archive accounting is 743,973,092/900,000,000 bytes, Storage 748,248,040 bytes and
database size 2,088,709,267 bytes. The compact index remains 27,828,224 bytes,
valid/ready, with four keys and no INCLUDE. The two serving indexes are also
valid/ready. Host metrics succeeded: available RAM 128,045,056 bytes, occupied
swap 284,401,664 bytes and load averages 0.36/0.30/0.37. Paging counters increased;
this snapshot does not establish an interval rate or a permanent capacity fix.
Activity showed no Lock wait or idle transaction; PostgreSQL start is unchanged.

Protected-read assertions passed; sanitized evidence is in followup-0323.json.
No new repair or recovery occurred, so the verified 02:28 three-region archive
read-back remains the recovery evidence. Zero repair attempts this check;
incident total remains one. No provider collection, phone app launch, billing,
routing, budget, raw-price or research change was made. Observations are not
verified pump truth or coverage beyond the fixed inventory.

## 04:24 UTC follow-up: scheduled service remains current

Run 66369 (04:00) completed 72/72 batches at 04:14:46.969069 UTC: 141,660
fixed-inventory observations, 93,417 stations with reported prices, 59/9/4
regional batches and zero wrong-region jobs. Requests were 72/92 and lookups
141,660/161,660. The existing cooldown expired at 02:14:25; no new upstream denial
or operator re-enable occurred. Ten Trends scopes published this complete run at
04:16:00.235154. Latest projection backlog is zero; three old November 10 derived
gaps remain unchanged. Deferred serving-write events did not leave a current
projection gap; their scheduled recovery is not a new operator repair.

Retained eight-day reconciliation remains 192 expected, 189 complete and three
previously known partial slots, with zero expired absent/running or current
absent slots. No new operational gaps were found. Historical gaps remain in saved
incident records; intentionally expired metadata is not treated as absent runs.
The city campaign remains complete and the original research window closed.

All six schedules and three routes are active. National retention returned HTTP
200 at 04:00, 04:10 and 04:20; the 04:00 pass removed 72 expired operational
objects and one metadata hour. Eligible raw objects, overdue metadata, deferred
hours and local daily-history backlog are zero. Local retention succeeded at
04:17; daily history has 705,752 rows, oldest day November 11, and 318,349,312
bytes. The existing raw-48-hour, metadata-eight-day and protected-data rules
remain unchanged.

Archive accounting is 744,182,376/900,000,000 bytes, Storage 748,457,324 bytes and
database size 2,093,288,595 bytes. The compact index remains 27,828,224 bytes,
valid/ready, four keys and no INCLUDE. Both serving indexes remain valid/ready.
Independent host metrics succeeded: 170,557,440 bytes available RAM, 461,910,016
bytes occupied swap, load averages 0.75/0.29/0.30. Cumulative paging counters
increased; this snapshot is not a precise interval rate or permanent capacity
fix. No Lock wait or idle transaction appeared in the activity snapshot, and
PostgreSQL start time remains 01:33:51.

Protected-read assertions passed; evidence is in followup-0424.json. No new
repair or recovery occurred; the 02:28 post-restart regional archive read-back
remains the recovery verification. Zero repair attempts this check, incident
total one. No provider collection, phone app launch, billing/routing/budget
change or raw/research modification occurred. Fixed-inventory observations are
not verified pump truth.

## 05:28 UTC follow-up: transient retries resolved automatically

Run 66429 (05:00) completed 72/72 batches at 05:16:13.798996 UTC: 141,660
fixed-inventory observations, 93,532 stations with reported prices, regional
batches 59/9/4 and zero wrong-region jobs. A network/runtime error at 05:01:57 and
HTTP 503 at 05:02:22 were retried automatically; the 503 shared cooldown expired
at 05:02:27. No operator re-enable or denial bypass occurred. Requests were 74/92
and lookups 145,660/161,660. Ten Trends scopes published at 05:17:00.278385.
Latest projection backlog is zero; three old November 10 derived gaps remain.

Retained reconciliation remains 192 expected slots, 189 complete and three known
partial, zero expired absent/running or current absent. No new operational gap
was found; older expired metadata and historical research gaps retain the
previously documented limitations. All six schedules and three routes remain
active; the city campaign remains complete and original research window closed.

National retention returned HTTP 200 at 05:00/10/20; the 05:00 pass removed 72
expired operational objects and one metadata hour. Eligible raw objects, overdue
metadata, deferred hours and local daily-history backlog are zero. Local retention
succeeded at 05:17; daily history has 706,186 rows, oldest day November 11,
318,349,312 bytes. Raw 48-hour and metadata eight-day retention and all existing
research/evaluation/latest-cache preservation boundaries remain unchanged.

Archive accounting is 744,402,701/900,000,000 bytes, Storage 748,677,649 bytes,
database size 2,097,392,787 bytes. The compact index is unchanged at 27,828,224
bytes, valid/ready, four keys without INCLUDE; both serving indexes remain valid.
Independent metrics succeeded: 110,608,384 bytes available RAM, 279,920,640 bytes
occupied swap, load 0.23/0.14/0.25. Cumulative paging increased; no exact interval
rate or permanent capacity fix is inferred. No Lock wait or idle transaction was
observed; PostgreSQL start remains 01:33:51.

Protected-read assertions passed; followup-0528.json contains the evidence. Zero
operator repair attempts this check, incident total one. The verified 02:28
post-restart regional archive samples remain the recovery evidence. No manual
provider collection, app launch, billing/routing/budget change or raw/research
modification occurred. Fixed-inventory observations are not verified pump truth.

## 06:28 UTC follow-up: complete scheduled sweep and current cache

Run 66489 (06:00) completed 72/72 batches at 06:16:24.689478 UTC, with 141,660
fixed-inventory observations and 93,642 stations containing reported prices.
Regional batches remain 59/9/4 with zero wrong-region jobs. The 06:09:15 transient
GraphQL response set the existing shared cooldown through 06:10:15; scheduled
retry succeeded automatically. Requests were 73/92 and lookups 143,660/161,660.
No denial bypass or operator re-enable occurred. All ten Trends scopes published
at 06:17:00.279149. Latest projection backlog is zero; the three old November 10
derived gaps remain unchanged.

Retained slots remain 192 expected, 189 complete and three previously known
partial, with zero expired absent/running or current absent. No new operational
gap is established; expired older metadata is not counted as absent runs and
historical research gaps remain closed. All six schedules and three routes are
active; the city campaign remains complete.

National retention returned HTTP 200 at 06:00/10/20; the 06:00 pass removed 72
expired operational objects and one metadata hour. Eligible raw objects, overdue
metadata, deferred hours and local daily-history backlog are zero. Local
retention succeeded at 06:17; daily history has 706,514 rows, oldest day November
11, occupying 318,349,312 bytes. Raw 48-hour/metadata eight-day retention and
research/evaluation/latest-cache preservation policies remain unchanged.

Archive accounting is 744,625,537/900,000,000 bytes, Storage 748,900,485 bytes and
database size 2,101,906,579 bytes. The compact index remains 27,828,224 bytes,
valid/ready, four keys without INCLUDE; both serving indexes remain valid/ready.
Host metrics succeeded: available RAM 116,985,856 bytes, occupied swap 283,729,920
bytes, load 0.11/0.17/0.38. Cumulative paging increased, not an exact interval
rate or evidence of permanent resolution. No Lock wait or idle transaction was
observed; PostgreSQL start remains 01:33:51.

Protected-read assertions passed; followup-0628.json contains sanitized evidence.
Zero repair attempts this check; incident total remains one. The 02:28 regional
archive read-back remains the recovery verification. No manual provider request,
app launch, billing/routing/budget change or raw/research modification occurred.
These are fixed-inventory observations, not verified pump truth.

## 07:32 UTC follow-up: scheduled service remains current

Run 66549 (07:00) completed all 72 batches at 07:14:34.558048 UTC, with 141,660
fixed-inventory observations and 93,622 stations containing reported prices.
Routes remain 59/9/4 with zero wrong-region jobs; requests 72/92 and lookups
141,660/161,660. The existing shared cooldown expired at 06:10:15; no new provider
denial or operator re-enable occurred. All ten Trends scopes published the
complete run at 07:15:00.321702. Latest projection backlog is zero and the three
old November 10 derived gaps remain unchanged.

The retained eight-day reconciliation remains 192 expected hourly slots, 189
complete and three known partial, with zero expired absent/running or current
absent slots. No new operational gap was found. Intentionally expired metadata
is not counted as absent runs; historical gaps remain in the saved incident
records. The city campaign and original research window remain closed.

All six schedules and three routes remain active. National retention returned
HTTP 200 at 07:00/10/20/30; the 07:00 pass removed 72 expired operational objects
and one metadata hour. Eligible raw objects, overdue metadata, deferred hours and
local daily-history backlog remain zero. Local retention succeeded at 07:17;
daily history has 706,701 rows, oldest day November 11, occupying 318,349,312
bytes. Raw 48-hour/metadata eight-day retention and protected research,
evaluation and latest-cache policies remain unchanged.

Archive accounting is 744,849,155/900,000,000 bytes, Storage 749,124,103 bytes and
database size 2,103,512,211 bytes. The compact index remains 27,828,224 bytes,
valid/ready, four keys without INCLUDE. Both serving indexes are valid/ready.
Independent host metrics succeeded: 138,809,344 bytes available RAM, 321,171,456
bytes occupied swap, load 0.07/0.05/0.14. Cumulative paging increased; this is not
an exact interval rate or proof of a permanent capacity fix. No Lock wait or idle
transaction appeared in the activity snapshot; PostgreSQL start is unchanged.

Protected-read assertions passed; evidence is in followup-0732.json. No new
repair or recovery; zero operator attempts this check, incident total one.
The 02:28 post-restart regional archive read-back remains recovery evidence.
No manual provider request, phone app launch, billing/routing/budget change or
raw/research modification occurred. Fixed-inventory observations are not verified
pump truth.
