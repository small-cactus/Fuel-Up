# October 12 16:14 UTC database timeout incident

The 15:09 UTC nationwide check had 112 complete operational hours, four previously reported partial hours, no expired absent/running slots, and a current-hour sweep within deadline. This incident began after that verified snapshot.

At the 16:14 UTC check:
- Protected CLI queries failed while creating the temporary login role: HTTP 544, connection terminated due to connection timeout. A sequential retry ended with HTTP 524.
- Two bounded service-role REST reads (national config and latest health) each timed out after 12 seconds. A subsequent config read timed out after 20 seconds.
- Protected infrastructure metrics returned HTTP 504.
- The dashboard initially showed Unhealthy, then Healthy. The latter did not establish recovery: direct reads still failed.
- Database logs showed statement timeouts (57014 at 16:12:14 and 16:16:11 UTC), connection/SSL EOF errors, and cron startup timeouts for national dispatch, cache publication, watchdog and projection repair at 16:13–16:15 UTC. Some dispatch calls completed at 16:16, so this was degraded/intermittent database service, not evidence of a deliberate collection pause or provider denial.

## Recovery attempt 1

At approximately 16:18 UTC, requested one project restart through Supabase Settings > General. Dashboard confirmed Restarting. No configuration, provider budgets, billing, collection identities/routes, raw objects, research retention boundaries or campaign activation were changed. No manual provider collection was requested. No source repair/deployment was justified by the available failure evidence.

## Recovery verification

- At 16:20 UTC a protected query returned PostgreSQL `57P03` (database shutting down), consistent with the requested restart.
- Protected reads succeeded again at approximately 16:24 UTC. At that point run 15914 still had 50/72 successful batches; renewed dispatch timestamps alone were not sufficient evidence of provider collection recovery.
- At 16:26:31 UTC the same scheduled run reached 58/72 batches, with eight successful observations after 16:25 UTC. No manual collection was invoked. Dispatch, cache publication, projection repair and watchdog cron calls succeeded after restart.
- Initial immutable archive read-back passed for one successful batch from each fixed region. Those first samples predated restart, establishing restored archive access only. A separate post-restart sample is recorded alongside this report.
- At 16:24 UTC operational coverage was 113 complete hours, four previously reported partial hours, no expired absent/running slots and one current running hour. The 16:00 hour deadline remains 17:00 UTC.
- The latest published Trends cache still represented the latest complete 15:00 sweep across all ten scopes, with no missing projection batches. Two unresolved repair records date to October 5 and belong to the closed research period; they are not new operational backlog.
- All five required national schedules remained active. Retention last succeeded at 16:20 UTC, with zero currently eligible raw objects. Continuous service remained enabled; the city campaign remained complete, and shared cooldowns were expired.
- The 16:24 snapshot recorded 741,892,404 accounted archive bytes against the 900,000,000-byte budget. Current-hour attempted work was 52 requests / 101,960 lookups, below limits of 92 / 161,660. All three routes had zero wrong-region jobs.

The protected metrics endpoint responded after restart, but its counters did not advance during a ten-second sample. Cached metrics cannot establish absence of memory pressure, swapping or IO contention. The root cause is not established and the restart is not a permanent fix. This remains repair attempt 1 for this incident; no source change or deployment was made.

At 16:27 the running hour had reached 61/72 successful batches. At 16:28 attempted work was 67 requests / 131,960 lookups, still below both budgets. Two current-hour batches archived before the outage lack derived projections (1143817 and 1143819). The projector intentionally waits until collection finishes, then repairs the latest complete sweep from saved archives without provider requests. Zero operational repair records were awaiting retry at that moment; that count alone does not mean every current-hour projection exists.

The second archive audit verified a new east-region observation at 16:26:38 UTC plus the already completed west-region samples. All checks passed; this is sampled archive verification, not a full-hour audit.

The scheduled 16:00 sweep completed all 72 batches at 16:29:23 UTC, before its deadline. It observed the entire fixed inventory of 141,660 station IDs, of which 85,512 had a price. All 114 operational complete sweeps plus the four previously reported partial hours are accounted for; no new expired gaps were created. At 16:29:42 the two projections still awaited scheduled repair, so Trends correctly retained the previous complete 15:00 cache. Fixed-inventory station observations and archive integrity are not verified pump truth.


Both deferred projections were repaired automatically on their first attempts, at 16:30:05 and 16:31:04 UTC. At 16:32:07 there were zero missing projections for run 15914. The full sweep consumed 74 attempts and 145,660 lookups, below the 92 / 161,660 caps. The 16:30 retention invocation succeeded.

At 16:33:08 UTC all ten Trends scopes referenced recovered run 15914. Publication began at 16:32:00 and its cron transaction completed successfully at 16:32:09. The next invocation also succeeded. This closes recovery verification for the incident: protected reads, scheduled full collection, sampled immutable archive read-back, deferred projections, cache publication and retention all succeeded. Root cause remains unconfirmed; monitoring continues.
