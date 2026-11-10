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
