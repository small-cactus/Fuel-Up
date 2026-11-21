# November 21 midnight partial sweep

At 07:24 UTC, scheduled nationwide collection was working. Run 70792 (07:00) completed all 72 batches at 07:14:35; all ten Trends scopes published at 07:15. Latest and retained complete-run projection backlogs were zero. Three regional immutable archive samples passed actual read-back, hashes, byte counts, schema, inventory ordering and provenance checks at 07:26. These are fixed-inventory app observations, not verified pump truth; this is a three-object sample, not an audit of all 72 objects.

New gap: midnight run 70405 completed partial at 01:01 with 33 successful and 39 missed batches. The missed jobs had zero attempts and HOUR_DEADLINE_MISSED. Successful jobs stopped at 00:06:47; four saved serving timeout events preceded that. This establishes incomplete dispatch but does not prove the underlying cause. The 01:00 and 02:00 sweeps subsequently completed. PostgreSQL still reports the November 20 01:13:20 start, so this recovery was automatic, not an operator restart this check. No repair or duplicate provider collection was performed.

The retained 192-hour window contains 190 complete hours and two partial hours (November 20 and 21 midnight), with no absent expired slots or expired running slots. Older operational gaps outside retained metadata remain recorded in earlier evidence; this is not a fresh all-time gap count.

Protected reads verified six active schedules, three fixed routes (59/9/4 batches), no wrong-region jobs, expired shared cooldown, request and lookup budgets, completed city campaign, and continuous national configuration. Retention returned HTTP 200 with zero eligible raw objects, overdue metadata or local history backlog. Local retention succeeded at 07:17. Accounted archive usage was 745,290,759 of 900,000,000 bytes; storage reported 749,565,707 bytes. Research and evaluation protections remain unchanged.

The compact reference index is valid and ready at 28,549,120 bytes, with no INCLUDE columns. Size alone does not establish bloat. A live 60.854-second host sample showed 117,448,704 available memory bytes, 82,001,920 bytes swapped in, 37,302,272 swapped out, 5.69% CPU I/O wait and no OOM kills. Resource pressure persists despite functioning service; no permanent resolution is claimed. No lock wait or idle transaction appeared in the activity snapshot.

Validation: protected status and three split SQL groups succeeded; explicit assertions checked the observed two-partial window and service invariants. Archive read-back passed for one sample in each fixed region. Zero repair attempts for this recurrence.

At the user's request, the Codex monitoring automation was changed through automation_update to FREQ=DAILY;BYHOUR=13;BYMINUTE=0;BYSECOND=0 (1 PM America/New_York). The automation remains active with its existing prompt and target chat. This changes the monitor only; hourly service collection is unchanged.
