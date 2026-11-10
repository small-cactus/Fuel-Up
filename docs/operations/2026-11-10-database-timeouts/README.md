# November 10 database access degradation

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
