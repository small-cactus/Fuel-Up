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
