# November 26 startup timeout recurrence

The daily check at 17:59 UTC found a new partial hour, run 77620 at 02:00. It completed 38 of 72 batches, observing 73,960 fixed-inventory stations (44,451 priced). Thirty-four jobs were never attempted and closed with HOUR_DEADLINE_MISSED at 03:00:04. Successful observations stopped at 02:07:45; four saved serving timeout events preceded that. No missed data was recreated.

## Failure diagnosis and automatic recovery

Saved cron records show widespread job startup timeout from 02:08 through approximately 02:59:13. Counts in the checked 02:00–03:30 interval were 35 discovery, 34 dispatch, 34 projection repair, 36 cache, five retention and nine watchdog startup failures. Local retention and both alert schedules also had startup failures. Two additional discovery/dispatch invocations starting at 02:26 hit statement timeouts. The dispatch error specifically reported waiting to lock the fuel_national_config tuple inside begin_fuel_national_hour.

Followed that new lock evidence into a small protected read of the deployed begin/dispatch functions and current blocker snapshot. The configuration row lock serializes hour setup and dispatch, and dispatch also holds an advisory transaction lock. The live snapshot at 18:00:53 shows no blocker or idle transaction. The historical blocker identity is not retained in these records. The row-lock timeout began after widespread startup failures, so it establishes contention during the outage, not the initiating cause. The saved HTTP response range starts at 12:00; historical worker responses have expired. No speculative lock removal, session termination or restart was performed.

Midnight and 01:00 completed normally. The 03:00 sweep (run 77645) completed 72/72 at 03:16:25, followed by a complete 04:00 sweep. PostgreSQL's start remains November 20 at 01:13:20. Recovery was automatic before this check; no operator repair caused it. The recurring initiating cause remains unresolved.

## Current verification

Latest complete run 78485 (17:00) finished 72/72 at 17:18:14, with 141,660 observed stations and 91,250 priced. It used 75 requests and 147,660 lookups; the previous hour used 74/145,660, both within unchanged 92/161,660 budgets. Three fixed routes matched 59 east, nine southwest and four northwest batches, with no wrong-region jobs. Ten cache scopes published at 17:19. Latest and retained complete-run projection backlogs were zero. All six service schedules are active. Shared cooldown expired naturally at 17:15:08. Continuous/enabled remain true, the old ends_at is the preserved research window, and the city campaign remains complete.

The retained 192-hour snapshot has 187 complete and five partial hours: November 20, 21 and 22 midnight, and November 24 and 26 at 02:00. Their missed batches total 179 (56+39+20+30+34). No expired absent slots, current absent slots or expired running slots were found. The current 17:00 slot was complete at that snapshot; the subsequent 18:00 hour is not claimed complete. Older aged-out gaps remain recorded separately, so this is not a fresh all-time gap count.

Actual read-back of three immutable run-78485 archive objects, one per fixed region, passed hashes, byte size, schema, ordered inventory IDs, time windows and provenance. This is a three-object sample, not all 72 archives or verified pump truth. The monitor issued no provider collection requests.

## Retention, capacity and host evidence

Recent national retention responses were HTTP 200. At 17:00, retention removed 72 operational raw objects and detached the bounded maximum of 100 references; at 17:10 it detached the remaining 14 and removed the deferred metadata hour. The 16:00 pass removed its hour directly. Latest retention at 17:50 was idle. Raw eligible, overdue metadata and overdue local-history counts were zero. Local retention succeeded at 17:17. Accounted archive usage is 747,909,806/900,000,000 bytes; storage reports 752,184,754 bytes. Raw 48-hour, metadata eight-day, original research, reserved evaluation and latest-cache protections were unchanged.

The compact reference index remains valid and ready at 28,803,072 bytes, up 40,960 bytes from yesterday, without INCLUDE columns. No recurrence of the former 129 MB index is visible; index size alone does not establish bloat. Latest-station autovacuum ran at 17:18 and reports 483 estimated dead tuples. A live 61.965-second host sample showed 128,806,912 available memory bytes, 234,528,768 bytes swapped in, 275,382,272 out, 18.79% CPU I/O wait and no OOM kills. Resource pressure persists. Current host metrics cannot reconstruct the earlier outage or prove permanent resolution.

Read the November 8 repair guidance. Full status, three split protected reads, targeted failure/job history, deployed lock-path inspection, live blocker checks, service invariant assertions and archive samples passed. Zero repair attempts for this recurrence: current scheduled service and archive access were already recovered, and the evidence does not support a targeted correction of the initiating failure. No restart, re-enable, schedule/routing/identity/billing change, provider replay, raw-price rewrite, or protected-data modification was performed. Evidence is in evidence-1759.json.
