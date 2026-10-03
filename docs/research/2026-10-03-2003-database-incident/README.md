# October 3, 20:03 UTC: database connectivity incident

The 19:00 nationwide sweep (3428) expired with 67/72 batches and 131,960/141,660 fixed-inventory IDs observed. Five batches covering 9,700 IDs are missing. These are historical gaps; no backfill or deadline extension was attempted. At the prior 19:03 check this hour was still within its deadline and making progress. City collection reached 1,722 successes with the same 54 historical misses.

The initial national status and coverage queries failed with HTTP 544 during login-role creation: `Connection terminated due to connection timeout`. The city query and a subsequent national status query succeeded intermittently. A further coverage query returned HTTP 524 (`supabase.com | 524: A timeout occurred`). Error evidence is preserved in `incident.json` and `coverage-timeout.txt`; IP addresses in the latter are redacted.

The refreshed authenticated dashboard reported Unhealthy: PostgREST, Auth, and Storage were unhealthy, while Database, Realtime, and Edge Functions reported healthy. The dashboard showed CPU 33%, disk 9%, RAM 67%, and 9/60 connections. This indicates intermittent database connectivity and unavailable dependent services, rather than proving a total database outage or a specific resource exhaustion cause. All six provider-free regional health/routing checks passed. Accounted nationwide archives were 230,403,198 bytes against the unchanged 900,000,000-byte budget. Both collectors and all main/watchdog schedules were enabled; the shared cooldown had expired and no newer provider access denial was observed.

## Recovery attempt 1

Restarted the existing Supabase project using the authenticated dashboard and standing repair authorization. The dashboard confirmed Restarting at approximately 20:06:40 UTC (`restarting.png`). No code, production ranking, provider identity/routing, schedules, collector pause state, budgets, campaign bounds, or raw archives were changed. No provider collection was manually invoked. Underlying infrastructure cause remains unconfirmed.

## Recovery verified at 20:13–20:15 UTC

All six dashboard services returned to Healthy (`recovered.png`) and protected database queries succeeded. The recovered diagnosis retained the original Cron errors: `job startup timeout`, alongside earlier archive-write and database-finish failures. Missed ordinals 54–58 were assigned to Virginia; four were never attempted. These failures occurred before the restart. The exact underlying infrastructure cause remains unconfirmed.

Existing scheduled dispatch resumed without manual collection. Run 3467 advanced from 2 to 11/72 successful batches, with 20,213 IDs observed and zero missed batches at the latest status capture. It remains in progress before its original 21:00 deadline; this is recovery evidence, not full-hour completion. All main and watchdog schedules remain enabled. City dispatch succeeded at 20:13 with zero due backlog, zero expired pending jobs, and unchanged 1,722 successes / 54 historical misses; its next scheduled city observations are not yet due.

`regional-readback.json` verifies one successful immutable batch from each fixed region with the committed `auditRegionalSample.mjs`. Hashes, exact station IDs, price schema, observation timestamps, and regional provenance passed. California and Oregon samples contain fresh post-restart observations; the Virginia sample is an earlier successful observation from the same hour. This sample does not prove whole-hour completeness or verified pump truth. The first sample attempt correctly declined verification before a successful California batch existed; no failure condition was weakened.

All 71 expected nationwide slots are counted, including hours without a run row: 56 complete, nine partial (including the new 19:00 gap), five historical expired unstarted, and one current running hour. No wrong-region jobs were found. Shared cooldown remains expired with no newer access denial. Accounted archives reached 230,886,498 of the unchanged 900,000,000-byte budget; database size is 355,568,787 bytes. Original error history remains intact.

Validation: protected health/coverage queries; successful post-restart scheduled dispatch; all six provider-free worker health/routing checks; immutable three-region archive read-back; JSON parsing and whitespace checks. One restart was used. No executable code changed or deployment was required. Long-term infrastructure stability is not established by this recovery.

Texas/DC coverage assumptions and Texas's one-ID aggregate discrepancy remain unchanged. Archived provider observations and missing prices are not verified pump truth. The reserved final two days remain untouched.
