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
