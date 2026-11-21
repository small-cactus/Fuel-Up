# November 21 midnight partial sweep

At 07:24 UTC, scheduled nationwide collection was working. Run 70792 (07:00) completed all 72 batches at 07:14:35; all ten Trends scopes published at 07:15. Latest and retained complete-run projection backlogs were zero. Three regional immutable archive samples passed actual read-back, hashes, byte counts, schema, inventory ordering and provenance checks at 07:26. These are fixed-inventory app observations, not verified pump truth; this is a three-object sample, not an audit of all 72 objects.

New gap: midnight run 70405 completed partial at 01:01 with 33 successful and 39 missed batches. The missed jobs had zero attempts and HOUR_DEADLINE_MISSED. Successful jobs stopped at 00:06:47; four saved serving timeout events preceded that. This establishes incomplete dispatch but does not prove the underlying cause. The 01:00 and 02:00 sweeps subsequently completed. PostgreSQL still reports the November 20 01:13:20 start, so this recovery was automatic, not an operator restart this check. No repair or duplicate provider collection was performed.

The retained 192-hour window contains 190 complete hours and two partial hours (November 20 and 21 midnight), with no absent expired slots or expired running slots. Older operational gaps outside retained metadata remain recorded in earlier evidence; this is not a fresh all-time gap count.

Protected reads verified six active schedules, three fixed routes (59/9/4 batches), no wrong-region jobs, expired shared cooldown, request and lookup budgets, completed city campaign, and continuous national configuration. Retention returned HTTP 200 with zero eligible raw objects, overdue metadata or local history backlog. Local retention succeeded at 07:17. Accounted archive usage was 745,290,759 of 900,000,000 bytes; storage reported 749,565,707 bytes. Research and evaluation protections remain unchanged.

The compact reference index is valid and ready at 28,549,120 bytes, with no INCLUDE columns. Size alone does not establish bloat. A live 60.854-second host sample showed 117,448,704 available memory bytes, 82,001,920 bytes swapped in, 37,302,272 swapped out, 5.69% CPU I/O wait and no OOM kills. Resource pressure persists despite functioning service; no permanent resolution is claimed. No lock wait or idle transaction appeared in the activity snapshot.

Validation: protected status and three split SQL groups succeeded; explicit assertions checked the observed two-partial window and service invariants. Archive read-back passed for one sample in each fixed region. Zero repair attempts for this recurrence.

At the user's request, the Codex monitoring automation was changed through automation_update to FREQ=DAILY;BYHOUR=13;BYMINUTE=0;BYSECOND=0 (1 PM America/New_York). The automation remains active with its existing prompt and target chat. This changes the monitor only; hourly service collection is unchanged.

## Daily follow-up at 18:03 UTC

No new expired gaps: the retained 192 slots comprise 189 complete, the same two partial midnight hours, and one current running hour due at 19:00. Latest complete run 71392 (17:00) finished all 72 batches at 17:15:05, with 141,660 observed and 91,655 priced stations. Ten cache scopes published at 17:16; latest and retained complete-run projection backlogs were zero. Three fresh regional archive samples passed actual read-back checks. These are fixed-inventory observations, not pump truth.

Current run 71452 progressed from 16 to 18 successful batches by 18:04:24. An upstream HTTP 503 imposed a five-second shared cooldown until 18:03:40; later scheduled requests resumed automatically. No restart, re-enablement, provider replay or repair was performed. The last PostgreSQL start remains November 20 01:13:20. Latest complete-run usage was 73 requests and 143,660 lookups, below the 92/161,660 limits.

All six schedules and three routes were active, with no wrong-region jobs. National retention at 18:00 returned HTTP 200, removing 72 operational objects and one expired metadata hour with zero deferrals; raw, metadata and local-history backlogs were zero. Local retention succeeded at 17:17, the latest due invocation. Accounted archive usage was 742,584,355/900,000,000 bytes; storage reported 746,859,303 bytes. Closed research and evaluation protections remain unchanged.

The compact reference index remains valid and ready at 28,549,120 bytes, unchanged from the morning, without INCLUDE columns. No lock waits or idle transactions were observed. Host counters advanced over 61.015 seconds: 137,998,336 available memory bytes, 216,449,024 bytes swapped in, 327,077,888 out, 16.63% CPU I/O wait and zero OOM kills. This remains resource pressure, not proof of permanent resolution. Full status, three split protected reads, service invariant assertions and archive sample validation passed. Evidence is in followup-1803.json.
