# November 9 database access and collection stall

The 15:09 UTC monitor encountered a new incident after healthy scheduled sweeps
through 14:00. A small protected read at 15:11 confirmed that the 14:00 run
54206 completed at 14:14:34 UTC. Run 54266 for 15:00 was still running. A later
successful batch read showed 12 succeeded and 60 queued; the newest successful
observation was 15:02:24 UTC. This hour has until 16:00 UTC and is not yet an
expired gap. Unavailable reads do not establish additional missing hours.

## Diagnosis

- CLI login-role creation intermittently failed with HTTP 544 connection timeouts.
- Direct service-role REST reads of three recent runs and the current run's job
  statuses each timed out after 12 seconds.
- The independent host metrics endpoint timed out and returned HTTP 504 on a
  longer diagnostic request. Current memory, swap and I/O values are unavailable.
- An activity snapshot showed the original status query waiting on DataFileRead
  at 76 seconds and its fallback query still active at 33 seconds, without lock
  blockers. Their clients had already timed out. A scoped attempt to cancel only
  those two monitor queries failed during login-role initialization and did not
  execute. A later activity snapshot showed neither query still active.
- A subsequent combined small read hit its explicit 10-second server timeout.
  Narrow activity and job queries did succeed intermittently. This is degraded
  database access, not proof of a connection-limit, lock, or particular hardware
  cause.
- The last healthy 14:09 snapshot had valid/ready indexes: compact retention
  reference 5,505,024 bytes, price ordering 34,471,936 bytes, and price lookup
  primary key 21,102,592 bytes. That does not show recurrence of the former
  129 MB retention index. The attempted fresh size/resource read failed before
  executing; no speculative reindex was performed.
- Management project status still reported ACTIVE_HEALTHY; it does not establish
  database or collection health. The public status page also reported operational
  service, which does not exclude a project-specific incident.

## Scoped monitoring repair

`protectedRead.mjs` now puts the status and fallback reads in a read-only implicit
transaction with server-side statement limits (15 seconds and 10 seconds) and a
one-second lock timeout. The final SELECT remains the returned result, and the
implicit transaction closes on completion. This prevents the previous client-only
timeout from leaving an unbounded monitor query running on the server. No global
database setting, provider request, scheduled collector or app behavior changes.

The diagnostics also distinguish process/fetch timeouts and metrics HTTP gateway
failures without exposing raw credential-bearing errors. The revised live status
returned STATEMENT_TIMEOUT and retained partial diagnostics; it did not falsely
report health. This change is a monitoring safeguard, not a claimed service repair.

Validation: four diagnostics tests passed. An isolated PostgreSQL test verified
that the wrapper preserves SELECT results, cancels slow work on the server before
the client timeout, rejects writes, and leaves the fixture intact. Syntax and diff
checks passed. The initial test caught loss of SELECT output with a trailing
COMMIT; the final implicit-transaction implementation passed all checks.

## External recovery blocker

Safari still displays GitHub sign-in for Supabase. The user was asked to complete
that existing sign-in so server logs and the previously authorized project restart
can be accessed if warranted. No credentials were entered and no restart was
requested. CLI project commands expose no restart action. Zero production
collection-repair attempts have been performed for this incident.

Continue from bounded saved evidence after access returns: inspect current runs,
absent expired slots, worker failures, resources and cooldowns; apply a justified
scoped repair; then verify scheduled collection, complete Trends publication,
projection/retention backlog and immutable archive read-back. Do not replay missed
provider collection or change routes, billing, budgets, raw prices or protected
research. Recovery has not yet been verified.

`evidence.json` contains sanitized observations. Temporary filenames are only
identifiers; embedded database/diagnostic timestamps are the observation times.

## 16:13 UTC: automatic collection recovery and one confirmed gap

The 15:00 run closed partial at 16:00:02 with 12 successful and 60 missed
batches. The retained eight-day slot check now contains 13 historical partial
hours, zero expired absent slots, and zero expired running slots. The current
16:00 run exists and was 62/72 successful at 16:13:47. No missed observations
were replayed or recreated.

Scheduled collection resumed without an agent restart, re-enable or production
repair. The previous monitor timeout safeguard is not evidence that it caused
this recovery. The first full status read still hit its 15-second server limit,
but independent host and bounded SQL fallback both succeeded. A subsequent full
status read succeeded at 16:15.

Host counters show substantial swapping and I/O wait. At 16:13, physical RAM was
431,308,800 bytes and occupied swap was approximately 734 MiB; trailing 15-minute
load was 4.69. Counters advanced by the 16:15 sample, with roughly 57% per-core
I/O wait over that observation interval. Exporter cadence limits precision, and
these samples do not establish the initiating cause. Fresh index measurements
show the compact retention index at 5,849,088 bytes, without recurrence of the
former 129 MB size. A follow-up snapshot had no idle-in-transaction sessions or
active autovacuum workers. Cumulative query I/O totals mainly reflect normal
publication work and cannot identify which query caused this incident.

One new successful immutable archive from each fixed route passed hash, size,
exact-ID, schema and provenance read-back at 16:14. The selected run was still
running: this proves three-object integrity, not sweep completion or pump truth.
The 16:15 status had no raw, operational-metadata or local-history retention
backlog; scheduled retention succeeded at 16:10. Final completion, projection and
cache verification follows below.

## Recovery verified at 16:21 UTC

- Scheduled run 54296 completed 72/72 batches at 16:17:14 UTC, with 141,660
  fixed-inventory observations and 85,798 reported prices. All three fixed routes
  completed their 59/9/4 assigned batches with zero routing mismatches. These
  observations are not verified pump truth.
- The sweep used 74 requests and 145,660 lookups, below the unchanged 92/161,660
  limits. A transient provider cooldown expired naturally, with no override.
- Three deferred projections repaired through the scheduled worker on their first
  attempts at 16:18:06, 16:19:05 and 16:20:06. No manual dispatch or provider
  collection was invoked. Missing projections and pending operational repairs
  are both zero.
- All ten Trends cache scopes published run 54296 at 16:21:00, verified at
  16:21:18. The earlier full status snapshot correctly still showed the old cache
  just before this publication; the separate cache evidence records the change.
- Retention returned HTTP 200 at 16:20. Eligible raw objects, overdue operational
  metadata and old local-history rows are zero. Accounted archive usage is
  712,071,338 / 900,000,000 bytes; total Storage is 716,346,286 bytes. All six
  required schedules remain active, continuous mode remains enabled, and the city
  campaign remains complete.
- The retained eight-day window contains 179 complete hours and 13 partial hours,
  including this incident's one new partial hour with 60 missed batches. There
  are no expired absent or expired-running slots. Pruned metadata is not counted
  as missing historical collection.
- Immutable archive read-back passed for one post-incident successful observation
  from each fixed region. This is a three-object integrity sample; the run/job
  manifests separately establish full-sweep completeness.

No project restart, production schema/configuration change, billing change,
re-enable, manual collection or archive rewrite occurred. Zero production repair
attempts were required during this recovery verification. The service recovered
automatically; neither the monitor safeguard nor these checks are credited with
restoring collection. Resource pressure is measured, but the initiating cause
remains unconfirmed and dashboard sign-in is still needed for deeper server-log
diagnosis. No phone app was opened.

Evidence: `recovery-status.json`, `recovery-checks.json`, `recovery-cache.json`,
`recovery-archive-readback.json`, `resource-followup.json`, and `followup-1613.json`.
