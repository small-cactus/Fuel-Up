# November 14 database access degradation

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
