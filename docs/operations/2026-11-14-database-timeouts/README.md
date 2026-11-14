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
