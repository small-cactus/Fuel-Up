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

## 08:35 UTC follow-up: transient retries completed automatically

Run 66609 (08:00) completed 72/72 batches at 08:18:34.644837 UTC, with 141,660
fixed-inventory observations and 93,576 stations containing reported prices.
Routes remain 59/9/4 with zero wrong-region jobs. Three automatic retries followed
transient GraphQL errors at 08:04:04 and 08:13:34 (60-second cooldowns) and HTTP
503 at 08:10:36 (five seconds). Requests 75/92 and lookups 147,660/161,660 remain
within budget. The shared cooldown expired at 08:14:34; no operator re-enable
occurred. All ten Trends scopes published complete run 66609 at 08:19:00.247562.
Serving timeout events left no latest projection backlog; the three previously
recorded November 10 derived gaps remain unchanged.

The retained eight-day reconciliation remains 192 expected hourly slots, 189
complete and three known partial, with zero expired absent/running or current
absent slots. No new operational gap was found. Intentionally expired metadata
is not counted as absent runs; older gaps remain in saved incident records.
All six schedules and three regional routes are active. The city campaign and
original research window remain closed.

National retention returned HTTP 200 at 08:00/10/20/30. The 08:00 pass removed 72
expired operational objects, one metadata hour and 31 detached references.
Eligible raw objects, overdue metadata, deferred hours and local daily-history
backlog are zero. Local retention succeeded at 08:17; daily history has 706,799
rows, oldest day November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata
eight-day retention and research/evaluation/latest-cache protections remain unchanged.

Archive accounting is 745,070,425/900,000,000 bytes, Storage 749,345,373 bytes and
database size 2,107,804,819 bytes. The compact index remains 27,828,224 bytes,
valid/ready, four keys without INCLUDE; both serving indexes remain valid/ready.
Independent host metrics succeeded: available RAM 138,375,168 bytes, occupied
swap 317,173,760 bytes, load 0.08/0.07/0.15. Cumulative paging counters are saved;
this snapshot is not an interval rate or proof of a permanent capacity fix.
No Lock wait or idle transaction was observed. PostgreSQL start remains 01:33:51
and shared_buffers remains 96 MiB with no pending restart.

Protected-read assertions passed; followup-0835.json contains sanitized evidence.
Zero operator repair attempts this check; incident total remains one. Existing
workers performed the transient retries automatically. The 02:28 post-restart
three-region archive read-back remains recovery evidence. No manual provider
request, phone app launch, billing/routing/budget change or raw/research
modification occurred. Fixed-inventory observations are not verified pump truth.

## 09:30 UTC follow-up: complete scheduled sweep without new errors

Run 66669 completed 72/72 batches at 09:14:34.417612 UTC, with 141,660
fixed-inventory observations and 93,572 stations containing reported prices.
All three fixed routes completed 59/9/4 batches with zero wrong-region jobs.
Requests 72/92 and lookups 141,660/161,660 remained within budget. No new error
event appeared this hour; the prior shared cooldown remains expired. All ten
Trends scopes published run 66669 at 09:15:00.376145. Latest projection backlog
is zero; three old November 10 derived gaps remain unchanged.

Retained reconciliation found 192 expected hourly slots, 189 complete and three
known partial, with zero expired absent/running or current absent slots. No new
operational gap was found. Expired older metadata is not counted as missing;
older operational and research gaps remain in their saved records. All six
schedules and three routes are active; the city campaign remains complete.

National retention returned HTTP 200 at 09:00/10/20/30. The 09:00 pass removed
72 expired operational objects, one metadata hour and 22 detached references.
Raw eligibility, overdue metadata, deferred hours and local daily-history backlog
are zero. Local retention succeeded at 09:17. Local history has 706,876 rows,
oldest day November 11, occupying 318,349,312 bytes. The 48-hour raw/eight-day
metadata and research/evaluation/latest-cache preservation policies are unchanged.

Archive accounting is 745,292,567/900,000,000 bytes, Storage 749,567,515 bytes and
database size 2,111,065,235 bytes. The compact index remains 27,828,224 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes are valid/ready.
Host metrics succeeded: available RAM 145,846,272 bytes, occupied swap
349,585,408 bytes, load 0.05/0.06/0.13. Cumulative paging and I/O counters are
saved, not an exact interval rate or proof of a permanent capacity fix. Activity
showed one DataFileRead wait, no Lock wait and no idle transaction. PostgreSQL
start remains 01:33:51; shared_buffers remains 96 MiB with no pending restart.

Protected-read assertions passed; sanitized evidence is in followup-0930.json.
No new repair or recovery; zero operator attempts this check, incident total one.
The 02:28 post-restart regional archive read-back remains recovery verification.
No manual provider requests, phone app launch, billing/routing/budget changes or
raw/research modifications occurred. These fixed-inventory observations are not
verified pump truth.

## 10:38 UTC follow-up: scheduled sweep complete after one automatic retry

Run 66729 completed 72/72 batches at 10:15:47.113625 UTC, with 141,660
fixed-inventory observations and 93,558 stations containing reported prices.
Routes completed 59/9/4 batches with zero wrong-region jobs. Requests 73/92 and
lookups 143,660/161,660 remained within budget. Job 4800280 recorded the generic
NETWORK_OR_RUNTIME_ERROR at 10:10:29, then succeeded automatically on attempt two
at 10:11:34.926238, with a 59,785-byte archive manifest and SHA-256. The stored
code does not establish a more specific cause. No operator re-enable occurred;
the old shared cooldown remains expired. All ten Trends scopes published run
66729 at 10:16:00.304041. Serving timeouts left zero latest projection backlog;
three old November 10 derived gaps remain unchanged.

Retained reconciliation found 192 expected slots, 189 complete and three known
partial, with zero expired absent/running or current absent slots. No new
operational gap was found. Expired older metadata is not counted as missing;
historical gaps remain in saved records. All six schedules and three routes are
active; the city campaign and original research window remain closed.

National retention returned HTTP 200 at 10:00/10/20/30. The 10:00 pass removed
72 expired operational objects, one metadata hour and ten detached references.
Eligible raw objects, overdue metadata, deferred hours and local-history backlog
are zero. Local retention succeeded at 10:17; history has 706,961 rows, oldest
day November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata eight-day
retention and protected research/evaluation/latest-cache policies are unchanged.

Archive accounting is 745,514,043/900,000,000 bytes, Storage 749,788,991 bytes and
database size 2,113,989,779 bytes. The compact index remains 27,828,224 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes are valid/ready.
Host metrics succeeded: available RAM 149,073,920 bytes, occupied swap
337,334,272 bytes, load 0.27/0.10/0.10. Cumulative paging and I/O counters are
saved; these are not interval rates or proof of a permanent capacity fix.
Activity showed one DataFileRead wait, no Lock wait and no idle transaction.
PostgreSQL start remains 01:33:51; shared_buffers is 96 MiB, no pending restart.

Protected-read assertions passed; followup-1038.json preserves sanitized evidence.
Zero operator repair attempts this check; incident total remains one. The 02:28
post-restart regional archive read-back remains recovery verification. The new
retry was verified through its successful manifest, without another raw-object
download. No manual provider request, phone app launch, billing/routing/budget
change or raw/research modification occurred. These fixed-inventory observations
are not verified pump truth.

## 11:37 UTC follow-up: scheduled service remains current

Run 66789 completed 72/72 batches at 11:14:43.973603 UTC, with 141,660
fixed-inventory observations and 93,514 stations containing reported prices.
The three fixed routes completed 59/9/4 batches, zero wrong-region jobs.
Requests 72/92 and lookups 141,660/161,660 remained within budget. Current-hour
events are serving client timeouts; no new provider error or cooldown appears.
The shared cooldown remains expired. All ten Trends scopes published the
complete run at 11:15:00.262727; latest projection backlog is zero. Three old
November 10 derived gaps remain unchanged.

Retained reconciliation remains 192 expected slots, 189 complete and three known
partial, with zero expired absent/running or current absent slots. No new
operational gap was found. Expired older metadata is not treated as missing;
older operational and research gaps remain in saved records. All six schedules
and three routes are active; the completed city campaign remains closed.

National retention returned HTTP 200 at 11:00/10/20/30; the 11:00 pass removed
72 expired operational objects, one metadata hour and 22 detached references.
Eligible raw objects, overdue metadata, deferred hours and local-history backlog
are zero. Local retention succeeded at 11:17. Local history has 707,101 rows,
oldest day November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata eight-day
retention and research/evaluation/latest-cache preservation remain unchanged.

Archive accounting is 745,734,439/900,000,000 bytes, Storage 750,009,387 bytes and
database size 2,114,161,811 bytes. The compact index remains 27,828,224 bytes,
valid/ready, four keys without INCLUDE; both serving indexes remain valid/ready.
Host metrics succeeded: available RAM 143,130,624 bytes, occupied swap
340,635,648 bytes, load 0.01/0.08/0.15. Cumulative paging and I/O counters are
saved, not interval rates or proof of permanent capacity resolution. One
DataFileRead wait, no Lock wait and no idle transaction appeared. PostgreSQL
start remains 01:33:51; shared_buffers is 96 MiB without pending restart.

Protected-read assertions passed; followup-1137.json contains sanitized evidence.
Zero operator attempts this check; incident total remains one. The 02:28
post-restart three-region archive read-back remains recovery verification.
No manual provider requests, phone app launch, billing/routing/budget changes,
or raw/research modifications occurred. These fixed-inventory observations
are not verified pump truth.

## 12:35 UTC follow-up: automatic retry and projection replay completed

Run 66849 completed 72/72 batches at 12:15:36.618386 UTC: 141,660 fixed-inventory
observations, 93,626 stations containing reported prices. Routes completed
59/9/4 batches with zero wrong-region jobs. Requests 73/92 and lookups
143,660/161,660 remained within budget. HTTP 503 at 12:06:22 triggered the saved
five-second shared cooldown; it expired at 12:06:27 and collection retried
automatically. Two serving client timeouts were recorded at 12:10. The existing
projection worker replayed job 4808918 at 12:16:07 on its first repair attempt,
without error. All ten Trends scopes published the complete run at 12:17:00.280781.
Latest projection backlog is zero; three old November 10 derived gaps remain.

The rolling eight-day slot query now reports 192 expected, 190 complete and two
partial, with zero expired absent/running or current absent slots. This change
is window rollover, not repaired history: a separate read confirms all three
known November 10 partial rows at 12:00/13:00/14:00 still exist. The 12:00 slot
falls outside now-minus-eight-days while its 13:00 deadline has not reached
metadata expiry. No new operational gap was found; older saved gap records
remain authoritative after expiry. All six schedules and three routes are active;
the city campaign and original research window remain closed.

National retention returned HTTP 200 at 12:00/10/20/30; the 12:00 pass removed
72 expired operational objects, one metadata hour and 13 detached references.
Raw eligibility, overdue metadata, deferred hours and local-history backlog are
zero. Local retention succeeded at 12:17. History has 707,957 rows, oldest day
November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata eight-day retention
and research/evaluation/latest-cache preservation policies are unchanged.

At 12:36:23, fresh immutable Storage read-back passed for three regional samples,
including east job 4808918 whose projection replayed automatically. Hash, byte
length, schema, station order, region, timestamp bounds and priced counts passed.
This verifies three objects, not every object in the 72-batch sweep and not pump
truth. No provider collection was invoked for verification.

Archive accounting is 745,951,276/900,000,000 bytes, Storage 750,226,224 bytes and
database size 2,114,333,843 bytes. The compact index remains 27,828,224 bytes,
valid/ready, four keys without INCLUDE; both serving indexes remain valid/ready.
Host metrics succeeded: available RAM 149,741,568 bytes, occupied swap
353,746,944 bytes, load 0.01/0.05/0.14. Saved cumulative paging/I/O counters are
not interval rates or proof of permanent capacity resolution. No Lock wait or
idle transaction appeared. PostgreSQL start remains 01:33:51 and shared_buffers
96 MiB without pending restart.

Protected-read and archive assertions passed; followup-1235.json holds evidence.
Zero operator repair attempts this check; incident total remains one. Retry and
projection replay were automatic. No manual provider request, phone app launch,
billing/routing/budget change or raw/research modification occurred.

## 13:42 UTC follow-up: complete sweep and current publication

Run 66909 completed 72/72 batches at 13:14:34.313422 UTC, with 141,660
fixed-inventory observations and 93,384 stations containing reported prices.
Routes completed 59/9/4 batches, zero wrong-region jobs. Requests 72/92 and
lookups 141,660/161,660 remained within budget. Current-hour recorded events
are serving client timeouts; no new provider error or cooldown appeared. The
shared cooldown remains expired. All ten Trends scopes published the complete
run at 13:15:00.385929. Latest projection backlog is zero; three old November 10
derived gaps remain unchanged.

The eight-day rolling reconciliation reports 192 expected slots, 191 complete
and one known partial, with zero expired absent/running or current absent slots.
The partial count decreased through window rollover, not recovered historical
collection: the saved 12:35 query records November 10 partial slots at
12:00/13:00/14:00, of which only 14:00 remains inside now-minus-eight-days.
Historical gaps remain in saved records and expired metadata is not counted as
absent. All six schedules and three routes are active; the city campaign and
original research window remain closed.

National retention returned HTTP 200 at 13:00/10/20/30/40. The 13:00 pass removed
72 expired operational objects, 1 metadata hour and 8 detached references.
Eligible raw objects, overdue metadata, deferred hours and local-history backlog
are zero. Local retention succeeded at 13:17; history has 708,474 rows, oldest
day November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata eight-day and
research/evaluation/latest-cache preservation policies remain unchanged.

Archive accounting is 746,153,939/900,000,000 bytes, Storage 750,428,887 bytes and
database size 2,114,612,371 bytes. The compact index is 27,910,144 bytes, an
81,920-byte increase since 12:35, valid/ready with four keys and no INCLUDE.
Both serving indexes remain valid/ready; this size change alone does not prove
bloat. Host metrics succeeded: available RAM 144,003,072 bytes, occupied swap
343,580,672 bytes, load 0.04/0.06/0.17. Saved cumulative paging/I/O counters are
not interval rates or proof of permanent capacity resolution. One DataFileRead
wait, no Lock wait and no idle transaction appeared. PostgreSQL start remains
01:33:51; shared_buffers remains 96 MiB without pending restart.

Protected-read assertions passed; followup-1342.json preserves sanitized evidence.
Zero operator attempts this check; incident total remains one. The fresh 12:36
three-region immutable archive read-back remains verification evidence. No
manual provider requests, phone app launch, billing/routing/budget changes or
raw/research modifications occurred. Fixed-inventory observations are not
verified pump truth.

## 14:43 UTC follow-up: automatic projection replay and current service

Run 66969 completed 72/72 batches at 14:14:45.874769 UTC, with 141,660
fixed-inventory observations and 93,267 stations containing reported prices.
Routes completed 59/9/4 batches, zero wrong-region jobs. Requests 72/92 and
lookups 141,660/161,660 remained within budget. Current-hour events are serving
client timeouts; no new provider error or cooldown appeared. The shared cooldown
remains expired. Existing projection repair replayed job 4817579 at 14:15:05.8669
on its first attempt without error. All ten Trends scopes published the complete
run at 14:16:00.226057. Latest projection backlog is zero; three old November 10
derived gaps remain unchanged.

The eight-day rolling reconciliation now reports 192/192 complete, zero partial,
expired absent/running or current absent slots. This does not erase historical
gaps: the saved November 10 partial slots at 12:00/13:00/14:00 are now outside
the rolling query. Their prior evidence remains preserved; no historical
backfill occurred and expired metadata is not counted as absent. All six
schedules and three fixed routes are active. The completed city campaign and
original research window remain closed.

National retention returned HTTP 200 at 14:00/10/20/30/40. The 14:00 pass removed
72 expired operational objects and one metadata hour, with zero detached
references. Eligible raw objects, overdue metadata, deferred hours and local
history backlog remain zero. Local retention succeeded at 14:17; history has
709,066 rows, oldest day November 11, occupying 318,349,312 bytes. Raw 48-hour,
metadata eight-day and research/evaluation/latest-cache policies are unchanged.

Archive accounting is 746,347,928/900,000,000 bytes, Storage 750,622,876 bytes and
database size 2,115,005,587 bytes. The compact index is 28,049,408 bytes,
valid/ready with four keys and no INCLUDE, up 139,264 bytes since 13:42. Both
serving indexes are valid/ready; this modest size change alone does not prove
bloat. Host metrics succeeded: available RAM 113,344,512 bytes, occupied swap
355,360,768 bytes, load 0.25/0.07/0.11. Saved cumulative paging/I/O counters are
not interval rates or proof of permanent capacity resolution. No Lock wait or
idle transaction appeared. PostgreSQL start remains 01:33:51, shared_buffers
96 MiB without pending restart.

Protected-read assertions passed; followup-1443.json contains sanitized evidence.
Zero operator repair attempts this check; incident total remains one. Projection
replay was automatic. Fresh three-region archive read-back at 12:36 remains
verification evidence; no new raw-object download this check. No manual provider
requests, phone app launch, billing/routing/budget changes or raw/research
modifications occurred. These observations are not verified pump truth.

## 15:44 UTC follow-up: automatic retry and replay completed

Run 67029 completed 72/72 batches at 15:15:14.162186 UTC, with 141,660
fixed-inventory observations and 93,150 stations containing reported prices.
Routes completed 59/9/4 batches, zero wrong-region jobs. Requests 73/92 and
lookups 143,660/161,660 stayed within budget. HTTP 503 at 15:09:33 triggered a
five-second shared cooldown, expired at 15:09:38; scheduled collection retried
automatically. The projection worker replayed job 4821908 at 15:16:08.178526 on
its first attempt without error. All ten Trends scopes published complete run
67029 at 15:17:00.232770. Latest projection backlog is zero; three old November
10 derived gaps remain unchanged. No operator re-enable occurred.

The rolling eight-day query has 192/192 complete slots, zero partial, expired
absent/running or current absent slots. Historical November 10 partials are
outside this rolling window, not repaired; their saved evidence remains. This
is not a fresh all-time gap recount after metadata expiry. All six schedules and
three routes remain active; the city campaign and research window remain closed.

National retention returned HTTP 200 at 15:00/10/20/30/40, removing 72 expired
operational objects and one metadata hour at 15:00. Raw eligibility, overdue
metadata, deferred hours and local-history backlog are zero. Local retention
succeeded at 15:17. Local history has 709,651 rows, oldest day November 11,
318,349,312 bytes. Raw 48-hour/metadata eight-day retention and protected
research/evaluation/latest-cache policies remain unchanged.

Archive accounting is 746,538,771/900,000,000 bytes, Storage 750,813,719 bytes;
database size is 2,115,316,883 bytes. The compact index is 28,147,712 bytes,
valid/ready with four keys and no INCLUDE, up 98,304 bytes since 14:43. Both
serving indexes are valid/ready; size alone does not establish bloat. Available
RAM is 140,771,328 bytes, occupied swap 348,983,296 bytes, load 0.05/0.03/0.11.
Cumulative paging/I/O counters are saved, not interval rates or proof of permanent
capacity resolution. No Lock wait or idle transaction appeared. PostgreSQL start
remains 01:33:51 and shared_buffers 96 MiB without pending restart.

Protected-read assertions passed; followup-1544.json holds sanitized evidence.
Zero operator attempts this check; incident total remains one. Retry/replay were
automatic. The 12:36 regional archive read-back remains evidence; no new raw
sample this check. No manual provider requests, phone app launch, billing,
routing or budget changes, or raw/research modifications occurred. Observations
represent fixed inventory, not verified pump truth.

## 16:47 UTC follow-up: scheduled collection and cleanup remain current

Run 67089 completed 72/72 batches at 16:15:47.729483 UTC, with 141,660
fixed-inventory observations and 93,069 stations containing reported prices.
All routes completed 59/9/4 batches with zero wrong-region jobs; requests 73/92
and lookups 143,660/161,660 stayed within budget. HTTP 503 at 16:10:59 triggered
a five-second shared cooldown, expired at 16:11:04; scheduled workers retried
automatically. Projection job 4826228 replayed at 16:16:07.443246 on its first
attempt without error. All ten Trends scopes published run 67089 at
16:17:00.235108. Latest and retained projection backlog are zero.

The rolling eight-day reconciliation is 192/192 complete, with zero partial,
expired absent/running or current absent slots. This does not erase older gaps.
The three previously retained November 10 derived gaps no longer appear after
this retention cycle; that is consistent with metadata expiry, not evidence of
historical reconstruction. Prior incident evidence remains preserved. No new
operational gap was found, and no fresh all-time count is inferred from expired
rows. All six schedules and three routes are active; the city campaign and
original research window remain closed.

National retention returned HTTP 200 at 16:00/10/20/30/40. At 16:00 it removed
72 expired objects and detached 100 references, deferring one metadata hour.
At 16:10 it detached the remaining 25 references and removed one metadata hour;
subsequent passes were idle with zero deferral. Raw eligibility, overdue metadata
and local-history backlog are zero. Local retention succeeded at 16:17; history
has 710,330 rows, oldest day November 11, occupying 318,349,312 bytes. Raw 48-hour,
metadata eight-day and research/evaluation/latest-cache policies are unchanged.

Archive accounting is 746,723,146/900,000,000 bytes, Storage 750,998,094 bytes and
database size 2,115,710,099 bytes. The compact index is 28,237,824 bytes,
valid/ready with four keys and no INCLUDE, up 90,112 bytes since 15:44. Both
serving indexes remain valid/ready; size alone does not establish bloat. Host
metrics succeeded: available RAM 126,705,664 bytes, occupied swap 338,915,328
bytes, load 0.01/0.06/0.09. Saved cumulative paging/I/O counters are not interval
rates or proof of permanent capacity resolution. One DataFileRead wait, no Lock
wait and no idle transaction appeared. PostgreSQL start remains 01:33:51,
shared_buffers 96 MiB without pending restart.

Protected-read assertions passed; followup-1647.json holds sanitized evidence.
Zero operator attempts this check; incident total remains one. Retry, projection
replay and deferred cleanup completed automatically. The 12:36 regional archive
read-back remains evidence; no fresh raw sample this check. No manual provider
requests, phone app launch, billing/routing/budget changes or raw/research
modifications occurred. Fixed-inventory observations are not verified pump truth.

## 17:47 UTC follow-up: two automatic retries, complete sweep

Run 67149 completed 72/72 batches at 17:16:03.773115 UTC: 141,660 fixed-inventory
observations, 92,930 stations containing reported prices. Routes completed
59/9/4 with zero wrong-region jobs; requests 74/92 and lookups 145,660/161,660
remained within budget. HTTP 503 at 17:06:14 and 17:11:25 caused five-second
shared cooldowns and automatic retries; the last cooldown expired at 17:11:30.
Projection job 4830548 replayed automatically at 17:17:08.097281 on its first
attempt without error. All ten Trends scopes published at 17:18:00.265962.
Latest and retained projection backlog are zero. No operator re-enable occurred.

The rolling eight-day reconciliation has 192/192 complete slots, no partial,
expired absent/running or current absent slots. Older gaps remain in saved
incident evidence; expired metadata does not establish repaired history or a
fresh all-time gap count. All six schedules and three routes remain active.
The completed city campaign and original research window remain closed.

National retention returned HTTP 200 at 17:00/10/20/30/40. The 17:00 pass removed
72 expired operational objects, one metadata hour and 15 detached references.
Raw eligibility, overdue metadata, deferred hours and local-history backlog are
zero. Local retention succeeded at 17:17; history has 711,085 rows, oldest day
November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata eight-day and
protected research/evaluation/latest-cache policies remain unchanged.

Archive accounting is 746,912,203/900,000,000 bytes, Storage 751,187,151 bytes and
database size 2,115,906,707 bytes. The compact index remains 28,237,824 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes are valid/ready.
Host metrics succeeded: available RAM 180,928,512 bytes, occupied swap
397,307,904 bytes, load 0.08/0.08/0.09. Saved cumulative paging/I/O counters are
not interval rates or proof of permanent capacity resolution. One DataFileRead
wait, no Lock wait and no idle transaction appeared. PostgreSQL start remains
01:33:51, shared_buffers 96 MiB without pending restart.

Protected-read assertions passed; followup-1747.json contains sanitized evidence.
Zero operator attempts this check; incident total remains one. Retries and
projection replay were automatic. The 12:36 regional archive read-back remains
verification evidence; no new raw sample this check. No manual provider requests,
phone app launch, billing/routing/budget changes or raw/research modifications
occurred. Fixed-inventory observations are not verified pump truth.

## 18:49 UTC follow-up: automatic recovery and fresh archive read-back

Run 67209 completed 72/72 batches at 18:16:34.509196 UTC, with 141,660
fixed-inventory observations and 92,880 stations containing reported prices.
Routes completed 59/9/4 with zero wrong-region jobs; requests 74/92 and lookups
145,660/161,660 stayed within budget. Jobs 4834840 and 4834846 recorded generic
NETWORK_OR_RUNTIME_ERROR at 18:10:09 and 18:12:38, then succeeded automatically
on attempt two at 18:11:13 and 18:13:49. The stored error code does not establish
a narrower cause. The prior shared cooldown remains expired; no re-enable
occurred. Projection job 4834873 replayed at 18:17:06.218279 on its first attempt
without error. All ten Trends scopes published at 18:18:00.232835. Latest and
retained projection backlog are zero.

At 18:49:52.826, immutable Storage read-back passed for three regional samples,
including retried east job 4834846 and replayed southwest job 4834873. SHA-256,
byte count, schema, station order, region, timestamp bounds and priced counts
passed. This verifies three objects, not every archive in the complete 72-batch
sweep; it is not pump-truth verification. No provider request was made by the audit.

The rolling eight-day reconciliation is 192/192 complete, with zero partial,
expired absent/running or current absent slots. Older gaps remain in saved
incident evidence; metadata expiry does not establish historical repair or a
fresh all-time gap count. All six schedules and three routes are active; the
completed city campaign and original research window remain closed.

National retention returned HTTP 200 at 18:00/10/20/30/40. The 18:00 pass removed
72 expired operational objects, one metadata hour and 87 detached references.
Raw eligibility, overdue metadata, deferred hours and local-history backlog are
zero. Local retention succeeded at 18:17; history has 712,190 rows, oldest day
November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata eight-day and
research/evaluation/latest-cache preservation policies remain unchanged.

Archive accounting is 747,092,693/900,000,000 bytes, Storage 751,367,641 bytes and
database size 2,117,905,555 bytes. The compact index remains 28,237,824 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes remain valid/ready.
Host metrics succeeded: available RAM 162,959,360 bytes, occupied swap 379,125,760
bytes, load 0.01/0.04/0.10. Saved cumulative paging/I/O counters are not interval
rates or proof of permanent capacity resolution. One DataFileRead wait, no Lock
wait and no idle transaction appeared. PostgreSQL start remains 01:33:51,
shared_buffers 96 MiB without pending restart.

Protected-read and archive assertions passed; followup-1849.json holds evidence.
Zero operator attempts this check; incident total remains one. Retries and replay
were automatic. No manual provider collection, phone app launch, billing/routing/
budget changes or raw/research modifications occurred.

## 19:52 UTC follow-up: scheduled service remains current

Run 67269 completed 72/72 batches at 19:14:36.468262 UTC, with 141,660
fixed-inventory observations and 92,879 stations containing reported prices.
Routes completed 59/9/4, zero wrong-region jobs; requests 72/92 and lookups
141,660/161,660 remained within budget. Five serving client timeouts left no
latest or retained projection backlog. No new provider error, cooldown or
operator re-enable occurred; the prior shared cooldown is expired. All ten
Trends scopes published complete run 67269 at 19:15:00.422826.

The rolling eight-day reconciliation is 192/192 complete, no partial, expired
absent/running or current absent slots. Older gap evidence remains preserved;
metadata expiry is not repaired history or a fresh all-time gap recount. All
six schedules and three routes are active. The city campaign and original
research window remain closed.

National retention returned HTTP 200 at 19:00/10/20/30/40/50. The 19:00 pass
removed 72 expired operational objects, one metadata hour and 72 detached
references. Raw eligibility, overdue metadata, deferred hours and local-history
backlog are zero. Local retention succeeded at 19:17; history has 713,117 rows,
oldest day November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata
eight-day and research/evaluation/latest-cache protections remain unchanged.

Archive accounting is 747,273,424/900,000,000 bytes, Storage 751,548,372 bytes and
database size 2,120,928,403 bytes. The compact index remains 28,237,824 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes are valid/ready.
Host metrics succeeded: available RAM 139,788,288 bytes, occupied swap
371,376,128 bytes, load 0.13/0.15/0.17. Cumulative paging/I/O counters are saved,
not interval rates or proof of permanent capacity resolution. One DataFileRead
wait, no Lock wait and no idle transaction appeared. PostgreSQL start remains
01:33:51; shared_buffers remains 96 MiB with no pending restart.

Protected-read assertions passed; followup-1952.json contains sanitized evidence.
Zero operator attempts this check; incident total remains one. The fresh 18:49
three-region archive read-back remains verification evidence. No manual provider
requests, phone app launch, billing/routing/budget changes or raw/research
modifications occurred. Fixed-inventory observations are not verified pump truth.

## 20:55 UTC follow-up: automatic retry and projection replay completed

Run 67329 completed 72/72 batches at 20:15:46.262666 UTC: 141,660 fixed-inventory
observations, 92,756 stations containing reported prices. Routes completed
59/9/4 with zero wrong-region jobs; requests 73/92 and lookups 143,660/161,660
remained within budget. HTTP 503 at 20:04:45 caused a five-second shared cooldown
and automatic retry; cooldown expired at 20:04:50. Projection job 4843511 replayed
at 20:16:07.498405 on its first attempt without error. All ten Trends scopes
published at 20:17:00.259293. Latest and retained projection backlog are zero;
no operator re-enable occurred.

The rolling eight-day reconciliation is 192/192 complete, with zero partial,
expired absent/running or current absent slots. Older gap evidence remains
preserved; expired metadata is not repaired history or a fresh all-time count.
All six schedules and three routes are active. The city campaign and original
research window remain closed.

National retention returned HTTP 200 at 20:00/10/20/30/40/50; the 20:00 pass
removed 72 expired operational objects, one metadata hour and 53 detached
references. Eligible raw objects, overdue metadata, deferred hours and local
history backlog are zero. Local retention succeeded at 20:17; history has
714,128 rows, oldest day November 11, occupying 318,349,312 bytes. Raw 48-hour,
metadata eight-day and research/evaluation/latest-cache policies are unchanged.

Archive accounting is 747,449,797/900,000,000 bytes, Storage 751,724,745 bytes and
database size 2,122,312,851 bytes. The compact index remains 28,237,824 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes remain valid/ready.
Host metrics succeeded: available RAM 149,393,408 bytes, occupied swap
381,792,256 bytes, load 0.06/0.12/0.15. Cumulative paging/I/O counters are saved,
not interval rates or proof of permanent capacity resolution. One DataFileRead
wait, no Lock wait and no idle transaction appeared. PostgreSQL start remains
01:33:51; shared_buffers is 96 MiB without pending restart.

Protected-read assertions passed; followup-2055.json holds sanitized evidence.
Zero operator attempts this check; incident total remains one. Retry and replay
were automatic. The 18:49 regional archive read-back remains verification
evidence; no fresh raw sample this check. No manual provider collection, phone
app launch, billing/routing/budget changes or raw/research modifications occurred.
These fixed-inventory observations are not verified pump truth.

## 21:53 UTC follow-up: automatic transient retry completed

Run 67389 completed 72/72 batches at 21:16:24.489608 UTC, with 141,660
fixed-inventory observations and 92,604 stations containing reported prices.
Routes completed 59/9/4, zero wrong-region jobs; requests 73/92 and lookups
143,660/161,660 remained within budget. A transient GraphQL error at 21:08:15
triggered a 60-second shared cooldown, expired at 21:09:15, followed by automatic
retry. Serving client timeouts left zero latest or retained projection backlog.
All ten Trends scopes published complete run 67389 at 21:17:00.313674.
No operator re-enable occurred.

The rolling eight-day reconciliation is 192/192 complete, with zero partial,
expired absent/running or current absent slots. Older gaps remain in saved
incident evidence; metadata expiry is not repaired history or an all-time
recount. All six schedules and three fixed routes are active. The completed
city campaign and original research window remain closed.

National retention returned HTTP 200 at 21:00/10/20/30/40/50; the 21:00 pass
removed 72 expired operational objects, one metadata hour and 53 detached
references. Raw eligibility, overdue metadata, deferred hours and local-history
backlog are zero. Local retention succeeded at 21:17; history has 715,173 rows,
oldest day November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata
eight-day and research/evaluation/latest-cache preservation remain unchanged.

Archive accounting is 747,618,757/900,000,000 bytes, Storage 751,893,705 bytes and
database size 2,122,566,803 bytes. The compact index remains 28,237,824 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes remain valid/ready.
Host metrics succeeded: available RAM 146,030,592 bytes, occupied swap
383,500,288 bytes, load 0.01/0.03/0.07. Cumulative paging/I/O counters are saved,
not interval rates or proof of permanent capacity resolution. No Lock wait or
idle transaction appeared. PostgreSQL start remains 01:33:51; shared_buffers
remains 96 MiB with no pending restart.

Protected-read assertions passed; followup-2153.json contains sanitized evidence.
Zero operator attempts this check; incident total remains one. Retry was
automatic. The 18:49 regional archive read-back remains verification evidence;
no new raw sample this check. No manual provider collection, phone app launch,
billing/routing/budget changes or raw/research modifications occurred.
Fixed-inventory observations are not verified pump truth.

## 22:51 UTC follow-up: complete scheduled sweep

Run 67449 completed 72/72 batches at 22:14:39.299669 UTC, with 141,660
fixed-inventory observations and 92,555 stations containing reported prices.
Routes completed 59/9/4, zero wrong-region jobs; requests 72/92 and lookups
141,660/161,660 remained within budget. Four serving client timeouts left zero
latest or retained projection backlog. No new provider error, cooldown or
operator re-enable occurred; the prior shared cooldown is expired. All ten
Trends scopes published complete run 67449 at 22:15:00.277950.

The rolling eight-day reconciliation is 192/192 complete, with zero partial,
expired absent/running or current absent slots. Older gaps remain in saved
incident evidence; metadata expiry does not establish repaired history or an
all-time gap recount. All six schedules and three routes are active; the city
campaign and original research window remain closed.

National retention returned HTTP 200 at 22:00/10/20/30/40/50. The 22:00 pass
removed 72 expired operational objects, one metadata hour and 52 detached
references. Raw eligibility, overdue metadata, deferred hours and local-history
backlog are zero. Local retention succeeded at 22:17; history has 716,022 rows,
oldest day November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata
eight-day and research/evaluation/latest-cache preservation remain unchanged.

Archive accounting is 747,775,844/900,000,000 bytes, Storage 752,050,792 bytes and
database size 2,122,869,907 bytes. The compact index remains 28,237,824 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes remain valid/ready.
Host metrics succeeded: available RAM 119,902,208 bytes, occupied swap
375,619,584 bytes, load 0.05/0.05/0.08. Cumulative paging/I/O counters are saved,
not interval rates or proof of permanent capacity resolution. One DataFileRead
wait, no Lock wait and no idle transaction appeared. PostgreSQL start remains
01:33:51; shared_buffers remains 96 MiB without pending restart.

Protected-read assertions passed; followup-2251.json holds sanitized evidence.
Zero operator attempts this check; incident total remains one. The 18:49 regional
archive read-back remains verification evidence; no new raw sample this check.
No manual provider requests, phone app launch, billing/routing/budget changes or
raw/research modifications occurred. Fixed-inventory observations are not
verified pump truth.

## 23:54 UTC follow-up: complete sweep after automatic retry

Run 67509 completed 72/72 batches at 23:15:04.573107 UTC, with 141,660
fixed-inventory observations and 92,606 stations containing reported prices.
Routes completed 59/9/4, zero wrong-region jobs; requests 73/92 and lookups
143,660/161,660 remained within budget. HTTP 503 at 23:12:34 caused a five-second
shared cooldown and automatic retry; cooldown expired at 23:12:39. Three serving
client timeouts left zero latest or retained projection backlog. All ten Trends
scopes published complete run 67509 at 23:16:00.156634. No operator re-enable
occurred.

The rolling eight-day reconciliation is 192/192 complete, with zero partial,
expired absent/running or current absent slots. Older gap evidence remains
preserved; metadata expiry is not repaired history or an all-time gap recount.
All six schedules and three fixed routes are active; the completed city campaign
and original research window remain closed.

National retention returned HTTP 200 at 23:00/10/20/30/40/50; the 23:00 pass
removed 72 expired operational objects, one metadata hour and 64 detached
references. Raw eligibility, overdue metadata, deferred hours and local-history
backlog are zero. Local retention succeeded at 23:17; history has 716,948 rows,
oldest day November 11, occupying 318,349,312 bytes. Raw 48-hour/metadata
eight-day and research/evaluation/latest-cache preservation remain unchanged.

Archive accounting is 747,930,514/900,000,000 bytes, Storage 752,205,462 bytes and
database size 2,123,115,667 bytes. The compact index remains 28,237,824 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes remain valid/ready.
Host metrics succeeded: available RAM 139,935,744 bytes, occupied swap
389,709,824 bytes, load 0.01/0.03/0.06. Cumulative paging/I/O counters are saved,
not interval rates or proof of permanent capacity resolution. One DataFileRead
wait, no Lock wait and no idle transaction appeared. PostgreSQL start remains
01:33:51; shared_buffers remains 96 MiB without pending restart.

Protected-read assertions passed; followup-2354.json holds sanitized evidence.
Zero operator attempts this check; incident total remains one. Retry was automatic.
The 18:49 regional archive read-back remains verification evidence; no new raw
sample this check. No manual provider collection, phone app launch, billing,
routing or budget changes, or raw/research modifications occurred. These
fixed-inventory observations are not verified pump truth.


## November 19, 00:50 UTC follow-up: complete sweep; bounded midnight cleanup

Run 67569 completed 72/72 at 00:14:37.547169 UTC, with 141,660 fixed-inventory
observations and 92,623 stations containing reported prices. The three fixed
routes completed 59/9/4 with zero wrong-region jobs. Requests 72/92 and lookups
141,660/161,660 remained within budget. Nine serving client timeouts left no
latest or retained projection backlog. All ten Trends scopes published run 67569
at 00:15:00.276006. The prior shared cooldown is expired; no new denial, operator
re-enable or provider retry was needed for this sweep.

Rolling operational reconciliation remains 192/192 complete, with zero partial,
expired absent/running or current absent slots. Preserved older gap evidence is
unchanged; expired metadata is not an all-time recount. All six schedules and
three routes are active. Continuous operation, the closed city campaign and
original research boundary remain unchanged.

National retention returned HTTP 200 at 00:00/10/20/30/40/50. The first pass
removed 72 expired operational objects, one metadata hour and 76 detached
references. Eligible raw objects, overdue national metadata and deferred hours
are zero. Local retention succeeded at 00:17. Its live function deliberately
prunes at most 20,000 rows per hourly pass. Midnight made November 11 eligible;
70,777 rows from that day remain for subsequent scheduled passes. This is bounded
cleanup in progress, not a failed schedule or a cleared backlog. Local history
has 771,489 rows and occupies 318,349,312 bytes. No retention policy was changed.

Archive accounting is 748,078,655/900,000,000 bytes, Storage 752,353,603 bytes,
and database size 2,126,793,875 bytes. The compact retention index remains
28,237,824 bytes, valid/ready with four keys and no INCLUDE. Both serving indexes
are valid/ready. Host metrics succeeded: available RAM 155,869,184 bytes,
occupied swap 420,667,392 bytes, load 0.30/0.16/0.16. Cumulative paging and I/O
counters are saved; these are not interval rates or permanent capacity proof.
No Lock wait or idle transaction appeared. PostgreSQL start remains November 18
01:33:51; shared_buffers remains 96 MiB without pending restart.

Protected-read assertions passed; followup-20261119-0050.json contains the
sanitized evidence, including the deployed bounded cleanup definition. Zero
operator repair attempts this check; November 18 incident total remains one.
The November 18 18:49 three-region immutable archive read-back remains the latest
raw verification; no new raw sample was downloaded. No manual provider
collection, phone app launch, billing/routing/budget changes or raw/research
modifications occurred. Fixed-inventory observations are not verified pump truth.


## November 19, 01:52 UTC follow-up: complete sweep and cleared midnight backlog

Run 67629 completed 72/72 at 01:15:05.868593 UTC, with 141,660 fixed-inventory
observations and 92,592 stations containing reported prices. Routes completed
59/9/4 with no wrong-region jobs; requests 72/92 and lookups 141,660/161,660.
Five serving client timeouts left zero latest or retained projection backlog.
All ten Trends scopes published run 67629 at 01:16:00.310793. The previous shared
cooldown remains expired, with no new denial or operator re-enable.

Rolling operational reconciliation remains 192/192 complete, with zero partial,
expired absent/running or current absent slots. Older gap evidence remains
preserved; this is not an all-time recount after metadata expiry. All six
schedules and all three fixed routes remain active. Continuous operation and
the closed city/research boundaries are unchanged.

National retention returned HTTP 200 at 01:00/10/20/30/40/50. The first pass
removed 72 expired operational objects, one metadata hour and 62 detached
references. Eligible raw objects, overdue metadata and deferred hours are zero.
The midnight local-history backlog is now zero, down from 70,777 at 00:50;
local retention succeeded at 01:17. These snapshots do not isolate how much
cleanup came from that bounded function versus other automatic metadata cleanup.
No manual cleanup occurred. Local history now has 702,049 rows, oldest day
November 12, occupying 318,349,312 bytes. Retention policies are unchanged.

Archive accounting is 748,203,963/900,000,000 bytes; Storage 752,478,911 bytes;
database 2,130,390,163 bytes. The compact retention index remains 28,237,824
bytes, valid/ready with four keys and no INCLUDE. Both serving indexes are
valid/ready. Host metrics succeeded: available RAM 119,320,576 bytes, occupied
swap 383,082,496 bytes, load 0.25/0.11/0.10. Saved cumulative paging/I/O counters
are not interval rates or proof of permanent capacity resolution. One DataFileRead
wait, no Lock wait and no idle transaction appeared. PostgreSQL start remains
November 18 01:33:51; shared_buffers remains 96 MiB with no pending restart.

Protected-read assertions passed; followup-20261119-0152.json contains sanitized
evidence. Zero operator repair attempts this check; November 18 incident total
remains one. Latest three-region immutable archive read-back remains November 18
18:49; no fresh raw sample was needed for this check. No manual provider
collection, phone app launch, billing/routing/budget changes or raw/research
modifications occurred. Fixed-inventory observations are not verified pump truth.


## November 19, 02:51 UTC follow-up: complete sweep after automatic 503 retry

Run 67689 completed 72/72 at 02:15:41.158871 UTC, with 141,660 fixed-inventory
observations and 92,603 stations containing reported prices. Routes completed
59/9/4 with zero wrong-region jobs; requests 73/92 and lookups 143,660/161,660
remained within budget. HTTP 503 at 02:05:14 caused a five-second shared cooldown,
expired at 02:05:19. Scheduled collection retried successfully without operator
re-enable. Eight serving client timeouts left zero latest or retained projection
backlog. All ten Trends scopes published run 67689 at 02:16:00.244086.

At 02:52:02, fresh immutable Storage read-back passed SHA-256, byte size, gzip,
schema, station ordering, region and timestamp checks for all three regional
samples. East sample 4869376 is the batch retried after HTTP 503: 44,573 bytes,
2,000 stations, 1,154 priced, observed 02:06:24. Northwest sample 4869437 has
213 stations and southwest 4869433 has 1,747. These are three verified objects,
not all 72 archives or independent pump-price truth. No provider collection was
triggered by this audit.

Rolling operational reconciliation remains 192/192 complete with zero partial,
expired absent/running or current absent slots. Older gap evidence remains
preserved; this is not an all-time recount after metadata expiry. All six
schedules and three routes are active. Continuous operation and the closed
city/research boundaries remain unchanged.

National retention returned HTTP 200 at 02:00/10/20/30/40/50. The first pass
removed 72 expired operational objects, one metadata hour and 47 detached
references. Eligible raw objects, overdue metadata, deferred hours and local
history backlog are zero. Local retention succeeded at 02:17; history has
702,581 rows, oldest day November 12, occupying 318,349,312 bytes. Retention
policies and research/evaluation/latest-cache preservation are unchanged.

Archive accounting is 748,321,450/900,000,000 bytes; Storage 752,596,398 bytes;
database 2,134,199,443 bytes. The compact index remains 28,237,824 bytes,
valid/ready with four keys and no INCLUDE. Both serving indexes remain valid/ready.
Host metrics succeeded: available RAM 193,662,976 bytes, occupied swap
433,516,544 bytes, load 0.51/0.23/0.19. Saved cumulative paging/I/O counters are
not interval rates or permanent capacity proof. One DataFileRead wait, no Lock
wait and no idle transaction appeared. PostgreSQL start remains November 18
01:33:51; shared_buffers remains 96 MiB without pending restart.

Protected-read and archive assertions passed; followup-20261119-0251.json holds
the sanitized evidence. Zero operator repair attempts this check; November 18
incident total remains one. Recovery was automatic. No phone app launch,
billing/routing/budget changes or raw/research modifications occurred.


## November 19, 03:53 UTC follow-up: complete sweep, no remaining backlog

Run 67749 completed 72/72 at 03:14:37.383458 UTC: 141,660 fixed-inventory
observations and 92,928 stations with reported prices. Three routes completed
59/9/4 with zero wrong-region jobs. Requests 72/92 and lookups 141,660/161,660
were within budget. 10 serving client timeouts left zero latest or retained
projection backlog. All ten Trends scopes published run 67749 at 03:15:00.267087.
The prior shared cooldown is expired; no new denial or operator re-enable.

Rolling reconciliation is 192/192 complete with zero partial, expired absent,
expired running or current absent slots. This does not erase older documented
gaps or recount expired metadata. All six schedules and three regional routes
are active. Continuous operation and closed city/research boundaries are unchanged.

Retention returned HTTP 200 at 03:00/10/20/30/40/50. The first pass removed
72 expired operational objects, 1 metadata hour and 28 detached references.
Eligible raw objects, overdue metadata, deferred hours and local-history backlog
are zero. Local retention succeeded at 03:17. History has 704,939 rows, oldest
day November 12, occupying 318,349,312 bytes. Raw 48-hour/metadata eight-day
policies and research/evaluation/latest-cache preservation are unchanged.

Archive accounting: 748,432,939/900,000,000 bytes; Storage: 752,707,887 bytes;
database: 2,139,040,915 bytes. Compact retention index remains 28,237,824 bytes,
valid/ready with four keys and no INCLUDE; both serving indexes are valid/ready.
Host metrics succeeded: available RAM 122,765,312 bytes, occupied swap
400,330,752 bytes, load 0.02/0.07/0.14. Cumulative paging/I/O counters are saved,
not interval rates or proof of permanent capacity resolution. One DataFileRead
wait, no Lock wait and no idle transaction appeared. PostgreSQL start remains
November 18 01:33:51, shared_buffers 96 MiB, no pending restart.

Assertions passed; followup-20261119-0353.json holds sanitized evidence. Fresh
three-region immutable archive read-back passed at 02:52 this day (previous
follow-up); no new sample or operator repair was needed this check. Operator
attempts this check: zero; November 18 incident total: one. No manual provider
collection, phone app launch, billing/routing/budget changes or raw/research
modifications occurred. Fixed-inventory observations are not verified pump truth.


## November 19, 04:56 UTC follow-up: complete sweep and automatic projection recovery

Run 67809 completed 72/72 at 04:14:47.867092 UTC: 141,660 fixed-inventory
observations, 92,958 stations with reported prices. Fixed routes completed
59/9/4 with zero wrong-region jobs. Requests 72/92 and lookups 141,660/161,660
remained within budget. 6 serving client timeouts were recorded. Scheduled
projection repair replayed job 4878068 on its first attempt at 04:15:09.683999,
without error; latest and retained projection backlog are zero. All ten Trends
scopes published run 67809 at 04:16:00.281413. Prior shared cooldown is expired;
no new denial, manual provider request or operator re-enable.

Rolling reconciliation is 192/192 complete, with zero partial, expired absent,
expired running or current absent slots. Older gap evidence is preserved; this
is not an all-time recount after metadata expiry. All six schedules and three
routes remain active. Continuous operation and closed city/research boundaries
are unchanged. National retention returned HTTP 200 at 04:00/10/20/30/40/50;
the first pass removed 72 operational objects, 1 metadata hour and
29 detached references. Eligible raw objects, overdue metadata, deferred hours
and local-history backlog are zero. Local retention succeeded at 04:17. History
has 706,209 rows, oldest day November 12, occupying 318,349,312 bytes. Raw
48-hour/metadata eight-day policies and research/evaluation/latest-cache
preservation remain unchanged.

Archive accounting is 748,537,206/900,000,000 bytes; Storage 752,812,154 bytes;
database 2,143,792,275 bytes. Compact index remains 28,237,824 bytes, valid/ready,
four keys with no INCLUDE; both serving indexes are valid/ready. Available RAM
is 131,686,400 bytes, occupied swap 400,953,344 bytes, load 0.15/0.09/0.09.
Cumulative paging/I/O counters are saved, not interval rates or permanent capacity
proof. One DataFileRead wait, no Lock wait or idle transaction appeared.
PostgreSQL start remains November 18 01:33:51; shared_buffers is 96 MiB with no
pending restart.

Assertions passed; followup-20261119-0456.json contains sanitized evidence.
Three-region immutable archive read-back passed at 02:52 today; this check used
database evidence for the automatic projection replay and did not download a
new raw sample. Operator attempts this check: zero; November 18 incident total:
one. No phone app launch, billing/routing/budget changes or raw/research
modifications occurred. Fixed-inventory observations are not verified pump truth.


## November 19, 05:52 UTC follow-up: complete sweep, no remaining backlog

Run 67869 completed 72/72 at 05:14:44.822395 UTC: 141,660 fixed-inventory
observations, 92,960 stations with reported prices. Fixed routes completed
59/9/4, zero wrong-region jobs. Requests 72/92 and lookups 141,660/161,660 were
within budget. 3 serving client timeouts left zero latest and retained
projection backlog. All ten Trends scopes published run 67869 at 05:15:00.251677.
The previous shared cooldown is expired; no new denial or operator re-enable.

Rolling operational reconciliation is 192/192 complete, zero partial, expired
absent/running or current absent slots. Older documented gaps remain preserved;
this is not an all-time recount after metadata expiry. All six schedules and
three routes remain active. Continuous operation and closed city/research
boundaries are unchanged. Retention returned HTTP 200 at 05:00/10/20/30/40/50;
the first pass removed 72 operational objects, 1 metadata hour and
41 detached references. Eligible raw objects, overdue metadata, deferred hours
and local-history backlog are zero. Local retention succeeded at 05:17; history
has 706,672 rows, oldest November 12, occupying 318,349,312 bytes. Raw 48-hour,
metadata eight-day and research/evaluation/latest-cache preservation are unchanged.

Archive accounting: 748,642,179/900,000,000 bytes; Storage: 752,917,127 bytes;
database: 2,145,275,027 bytes. Compact index remains 28,237,824 bytes, valid/ready,
four keys with no INCLUDE; both serving indexes are valid/ready. Host metrics
succeeded: available RAM 134,737,920 bytes, occupied swap
399,802,368 bytes, load 0.37/0.12/0.09. Cumulative paging/I/O counters are saved,
not interval rates or proof of permanent capacity resolution. One DataFileRead
wait, no Lock wait or idle transaction appeared. PostgreSQL start remains
November 18 01:33:51; shared_buffers 96 MiB, no pending restart.

Assertions passed; followup-20261119-0552.json holds sanitized evidence. The
latest three-region immutable archive read-back passed at 02:52 today; no new
sample or repair was needed. Operator attempts this check: zero; November 18
incident total: one. No manual provider collection, phone app launch,
billing/routing/budget changes or raw/research modifications occurred.
Fixed-inventory observations are not verified pump truth.


## November 19, 06:57 UTC follow-up: complete sweep, no remaining backlog

Run 67929 completed 72/72 at 06:14:34.235052 UTC: 141,660 fixed-inventory
observations, 92,952 stations with reported prices. Routes completed 59/9/4 with
zero wrong-region jobs; budgets 72/92 requests and 141,660/161,660 lookups.
6 serving client timeouts left zero latest or retained projection backlog.
All ten Trends scopes published run 67929 at 06:15:00.307541. Prior cooldown is
expired; no new denial or operator re-enable. Rolling reconciliation is 192/192
complete with zero partial, expired absent/running or current absent slots.
Older documented gaps remain preserved, not recounted from expired metadata.
All six schedules and three routes are active; continuous operation and the
closed city/research boundaries remain unchanged.

National retention returned HTTP 200 at 06:00/10/20/30/40/50, removing
72 operational objects, 1 metadata hour and 38 detached references at 06:00.
Eligible raw objects, overdue metadata, deferred hours and local-history backlog
are zero. Local retention succeeded at 06:17; history has 706,975 rows, oldest
November 12. Raw 48-hour/metadata eight-day policies and research/evaluation/
latest-cache preservation are unchanged. Archive accounting is
748,743,581/900,000,000 bytes; Storage 753,018,529 bytes; database 2,145,512,595
bytes. Compact index remains 28,237,824 bytes, valid/ready with four keys and no
INCLUDE; both serving indexes are valid/ready.

Host metrics succeeded: available RAM 189,698,048 bytes; occupied swap
442,081,280 bytes; load 0.05/0.07/0.08. Saved cumulative paging/I/O counters
are not interval rates or permanent capacity proof. One DataFileRead wait, no
Lock wait or idle transaction appeared. PostgreSQL start remains November 18
01:33:51; shared_buffers 96 MiB, no pending restart. Protected-read assertions
passed; followup-20261119-0657.json contains sanitized evidence. Latest
three-region immutable archive read-back passed at 02:52 today; no fresh sample
or repair was needed. Operator attempts this check: zero; November 18 incident
total: one. No manual provider collection, phone app launch, billing/routing/
budget changes or raw/research modifications occurred. Fixed-inventory
observations are not verified pump truth.


## November 19, 07:58 UTC follow-up: complete sweep after automatic 503 retry

Run 67989 completed 72/72 at 07:15:25.440399 UTC, with 141,660 fixed-inventory
observations and 92,934 stations containing reported prices. Routes completed
59/9/4 with zero wrong-region jobs. Requests 73/92 and lookups 143,660/161,660
remained within budget. HTTP 503 at 07:11:15 caused a five-second shared cooldown,
expired at 07:11:20. Scheduled collection retried successfully without operator
re-enable. One serving client timeout left zero latest or retained projection
backlog. All ten Trends scopes published run 67989 at 07:16:00.242748.

At 07:59:16.740, fresh immutable Storage read-back passed SHA-256, byte size,
gzip, schema, station ordering, region and timestamp checks for all three
regional samples. East job 4891007 is the automatically retried batch: 52,454
bytes, 2,000 stations, 1,438 priced, observed 07:12:25. Northwest job 4891037
contains 213 stations; southwest job 4891033 contains 1,747. These are three
verified objects, not all 72 archives or independent pump-price truth. The audit
made no provider collection requests.

Rolling reconciliation remains 192/192 complete, zero partial, expired absent/
running or current absent slots. Older gap evidence remains preserved; this is
not an all-time recount after metadata expiry. All six schedules and three
routes are active. Continuous operation and the closed city/research boundaries
are unchanged. Retention returned HTTP 200 at 07:00/10/20/30/40/50, removing 72
operational objects, one metadata hour and 44 detached references at 07:00.
Eligible raw objects, overdue metadata, deferred hours and local-history backlog
are zero. Local retention succeeded at 07:17. History has 707,152 rows, oldest
November 12. Raw 48-hour/metadata eight-day policies and research/evaluation/
latest-cache preservation remain unchanged.

Archive accounting is 748,847,149/900,000,000 bytes; Storage 753,122,097 bytes;
database 2,146,102,419 bytes. Compact index remains 28,237,824 bytes, valid/ready,
four keys with no INCLUDE; both serving indexes are valid/ready. Host metrics
succeeded: available RAM 169,041,920 bytes, occupied swap
417,329,152 bytes, load 0.28/0.15/0.14. Cumulative paging/I/O counters are saved,
not interval rates or permanent capacity proof. No IO/Lock wait or idle
transaction appeared in the activity snapshot. PostgreSQL start remains
November 18 01:33:51; shared_buffers 96 MiB, no pending restart.

Protected-read and archive assertions passed; followup-20261119-0758.json holds
sanitized evidence. Operator repair attempts this check: zero; November 18
incident total: one. Recovery was automatic. No phone app launch, billing/
routing/budget changes or raw/research modifications occurred.
