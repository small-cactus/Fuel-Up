# October 7, 04:13 UTC database incident

The 04:00 national run (8175) stalled at 15/72 successful batches and 28,213
observed catalog IDs. Its last provider request was 04:03:15 UTC and its last
completed batch was 04:03:09. Scheduled dispatch continued through 04:14, but
protected read-back at 04:16:54 showed no further progress. The hour was still
before its 05:00 deadline; this was a collection stall, not yet a missing hour.
The preceding 03:00 sweep completed all 72 batches and 141,660 IDs at 03:15:04.

All three provider-free regional health checks returned HTTP 200 with matching
assigned and actual regions. The collector remained enabled; the shared cooldown
had expired at 02:13:21. There was no new provider denial. Accounted archive use
was 515,937,217 of the unchanged 900,000,000-byte budget.

## Diagnosis

Saved scheduled responses show repeated HTTP 503
`DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED` from Virginia and Northern
California. These are database claim failures, not provider response failures.
A 04:18 activity snapshot showed a claim transaction blocking other national
transactions, and an active autovacuum worker. It does not prove that vacuum,
locking, or a particular query caused the outage. No idle transaction or
long-running user query was identified for safe targeted cancellation.

An aggregate monitoring query hit its 20-second statement timeout; another
monitoring read hit its client timeout. A subsequent protected query failed to
initialize its login role with Management API HTTP 544, connection terminated
due to connection timeout. The privileged resource endpoint returned HTTP 504.
Thus metrics could not establish memory/IO rates for this incident. Prior
memory-pressure incidents are not proof of this incident's initiating cause.

A diagnostic query initially referenced a nonexistent jobs.updated_at column;
that local diagnostic error was corrected and is not a service failure.

## Recovery attempt 1

Restarted only this Supabase project through its authenticated dashboard at
approximately 04:20 UTC. The dashboard confirmed Restarting. This follows the
user's proactive recovery authorization. No compute/billing change, provider
request, identity change, schedule replacement, raw-price modification, or
research-window extension was performed. The phone app was not opened.

Twenty-three focused cache-serving, archive, regional-routing and projection
repair tests passed. No executable source change or deployment was needed.
Restart screenshot: /tmp/fuel-restarting-20261007.png.

Recovery verification below distinguishes restart acceptance from resumed
scheduled collection and immutable archive writes.

A 04:22 read during the restart transition still showed the old postmaster
start time, so it was not treated as restart completion. It verified 151 expected
national slots: 134 complete, 11 historical expired partial, 5 historical
unstarted, and one current unfinished hour. The latest expired gap remains
October 6 10:00. All main/watchdog schedules remained active. A later query
returned PostgreSQL 57P03, database system is shutting down, consistent with the
in-progress restart; no second restart was requested.

## Recovery verified

PostgreSQL restarted at 04:26:03 UTC. At 04:27, ordinary scheduled workers
successfully completed three Northern California batches and two city jobs.
At 04:28 the national sweep had reached 19/72 successful batches (35,960 IDs),
with new Virginia work also progressing. City successes reached 3,644 and the
historical miss count stayed 54. Zero expired overdue city jobs and zero
wrong-region national jobs were found. Main dispatcher/projection/cache Cron
jobs succeeded again; the five-minute watchdogs remain active and their next
post-restart execution was not yet due at this verification.

At 04:27:56, immutable read-back verified hashes, byte sizes, exact station ID
sets, price schema, original observation windows and regional provenance for
one batch per assigned region. The Northern California object was newly
collected at 04:27:23 after restart, establishing recovered archive writes.
The Virginia and Oregon samples predate restart; they establish integrity of
preserved data, not new collection in those regions. This is a regional sample,
not full-hour completion or verified pump truth.

Accounted archives reached 516,217,009 of 900,000,000 bytes. All ten Trends
scopes still serve the latest complete 03:00 run with no missing projection
batches; the 04:00 run remains in progress before 05:00. No new expired hour
was lost as of verification. The historical 11 partial and 5 unstarted national
hours remain preserved. The resource metrics endpoint returned HTTP 520 during
recovery, so no claim is made about recovered metrics or a permanent resource
fix. Dashboard Healthy is supporting evidence only; real worker responses and
archive read-back establish collection recovery.

One restart was used. No second repair was needed. Root initiating cause remains
unproven beyond database availability and claim failures. Monitoring continues
under the existing plan and campaign end time. Recovery screenshot:
/tmp/fuel-recovered-20261007.png.
