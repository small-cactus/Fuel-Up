# Database and public Trends timeouts at 22:28 UTC

The 22:28 heartbeat encountered a new recurrence of timeout symptoms after complete scheduled sweeps through 21:00 UTC. The cause is not established, and this is not proof that the earlier Storage-scan issue has returned.

## Observed evidence

- The full protected `status.mjs` query returned Supabase management API HTTP 524 at 22:30:39 UTC.
- A separate protected budget/retention query returned HTTP 524 at 22:30:53 UTC.
- A narrower jobs/events/schedules query failed with HTTP 544: `Failed to create login role: Connection terminated due to connection timeout`.
- Two cache-only public national regular-grade Trends requests timed out at their 20-second and 30-second client limits. Neither request collected provider data. Public Trends availability is impaired from this observer; no successful response or recovered cache delivery is claimed.
- Basic API and project-host HTTP requests returned quickly (404 for their root paths), distinguishing these observations from complete local network loss. This does not isolate the root cause.

A small config/run query succeeded. Continuous collection remains enabled. The last dispatch was 22:29:02 UTC, the last provider request was 22:06:23 UTC, and the shared cooldown expired at 22:04:16 UTC. The stored halt reason was `UPSTREAM_TRANSIENT_GRAPHQL`; it is not an active disabled state. Run 18987 for 22:00 remains running and has until 23:00 UTC. The last complete run is 18927 (21:00), completed at 21:16:05 UTC.

A subsequent bounded reconciliation succeeded:

| Check | Result |
| --- | --- |
| Operational hours from October 7 at 19:00 UTC | 172 |
| Complete | 161 |
| Previously known partial | 10 |
| Expired absent / expired running | 0 / 0 |
| Current absent | 0 |
| Current 22:00 requests / maximum | 21 / 92 |
| Current 22:00 lookups / maximum | 39,960 / 161,660 |
| Published cache | Run 18927, ten scopes, published 21:20 UTC |

No new expired gap is established. The current hour must not be counted as missed before its deadline. The cache's latest complete sweep remains 21:00; these database rows do not prove successful public delivery during the timeout interval.

## Scope and next check

Current regional completion, projection backlog, cron execution, archive capacity and retention eligibility could not be reverified. Their most recent successful check was at 21:30 UTC: all three fixed routes completed 72/72 batches, latest-complete projection backlog zero, accounted archive 725,062,075/900,000,000 bytes, active national schedules, successful retention dispatches, and zero research jobs marked archive-deleted.

No repair, deployment, re-enable, schedule mutation, provider replay, raw overwrite, billing change, research deletion, or phone interaction was performed. New-incident repair attempts: zero. The earlier incident's sole index attempt was rejected for lack of Storage table ownership and was not retried.

On the next check, reconcile the 22:00 deadline and subsequent slots including absent rows, verify all three routes and maintenance checks, and require scheduled recovery plus immutable archive read-back before reporting recovery. Fixed-inventory observations are not verified pump truth.

## 23:27 heartbeat: one new incomplete hour confirmed

The 22:00 run 18987 became partial at 23:00:00 UTC. Reconciliation now shows 173 expected operational slots, 161 complete, 11 partial, zero expired absent rows and zero expired running rows. This is one newly confirmed incomplete hour beyond the ten previously reported. The current 23:00 run 19019 remains running and is allowed until October 15 at 00:00 UTC; it is not counted as missed yet.

Collection remains enabled and continuous. Dispatch advanced to 23:27:03 UTC, but the last recorded provider request remains 22:06:23 UTC. The shared cooldown expired at 22:04:16 UTC. No re-enable or cooldown override is appropriate. The full status query again returned HTTP 524 (23:29:38 UTC); the combined diagnostic query exceeded its 60-second bound, and a narrower job-count query failed during login-role creation with HTTP 544 database connection timeout. Current successful/missed batch counts, regional execution, budgets, projection backlog, capacity and retention execution remain unverified. The earlier budget result was 21 requests and 39,960 lookups for the 22:00 run; it is not a fresh count.

A cache-only public regular-grade Trends request returned HTTP 200 in 5,478 ms with no history error. Its latest point remains the complete 21:00 sweep (68,928 eligible priced stations). The database cache still contains ten scopes for run 18927 published at 21:20 UTC. This establishes public response recovery for that request only, not resumed scheduled collection or a fresh 22:00 sweep. No immutable read-back was performed because scheduled recovery has not been established.

No repair attempt or production mutation was made. The recurrence still has zero repair attempts; the prior rejected Storage index attempt was not repeated. Sanitized evidence is in `followup-2327.json`. Continue monitoring for additional expired gaps and obtain scheduled collection plus archive read-back before reporting full recovery.

## October 15, 00:31 heartbeat: second incomplete hour

The 23:00 run 19019 became partial at 00:00:00 UTC. Reconciliation from the operational start now shows 174 expected slots, 161 complete, 12 partial, zero expired absent rows and zero expired running rows. This recurrence has two incomplete hours (22:00 and 23:00), in addition to ten older partial hours. Current run 19057 for 00:00 is still running and has until 01:00 UTC; it is not counted as missed.

Continuous collection remains enabled. Last dispatch advanced to 00:31:00 UTC; last provider request remains October 14 at 22:06:23 UTC. The stored shared cooldown expired at 22:04:16 UTC. The cache remains ten scopes for complete run 18927 (21:00), published at 21:20 UTC. A cache-only public national regular-grade request timed out at 25,006 ms, so the successful public response during the preceding check was not sustained availability evidence.

The full status read failed with PostgreSQL SQLSTATE 57014, `canceling statement due to statement timeout`, specifically in SQL function `fuel_national_retention_candidates`, statement 1 (management API HTTP 400). This establishes timeout in the diagnostic retention-candidate calculation, not proof that the retention worker deleted anything or that its schedule failed. A separate protected jobs/regions/cron/retention/backlog diagnostic exceeded its 60-second bound. Current per-region batches, request/lookup totals, projection backlog, archive usage and retention execution remain unverified. Do not carry forward the last healthy measurements as current.

No speculative change, repair attempt, re-enable, cooldown override, provider replay, raw deletion/overwrite, billing change or phone interaction was made. Existing capacity protections and the closed research window remain untouched. Recurrence repair attempts remain zero; the earlier Storage-owner index rejection was not retried. Sanitized results are saved in `followup-0031.json`. Scheduled recovery and immutable archive read-back remain required before declaring recovery.

## October 15, 01:29 heartbeat: third incomplete hour and saved worker failures

The 00:00 run 19057 became partial at 01:00:02 UTC. Reconciliation now shows 175 expected operational slots, 161 complete, 13 partial, zero expired absent rows and zero expired running rows. This recurrence has three incomplete hours (22:00, 23:00 and 00:00). Current 01:00 run 19101 remains running, allowed until 02:00 UTC, and is not counted as missed.

Collection remains enabled and continuous; last dispatch advanced to 01:28:08 UTC, while the last provider request remains October 14 at 22:06:23 UTC. The shared cooldown remains expired. Saved pg_net responses at 01:26–01:28 show HTTP 503 `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED` from all three fixed routes. Expected and actual execution regions match for us-east-1, us-west-1 and us-west-2. These establish internal database job-claim failures rather than a new provider denial; they do not establish the database slowdown's root cause.

The full status query failed with SQLSTATE 57014 inside `fuel_national_archive_bytes` (management API HTTP 400). The separate jobs/regions/schedules/retention/backlog diagnostic exceeded its 60-second bound. Current batch counts, request/lookup totals, archive capacity, projection backlog and retention execution therefore remain unverified. The exact accounting/capacity guard was not weakened, and the previously rejected Storage-owner index change was not retried.

The public cache-only Trends request succeeded with HTTP 200 in 9,219 ms and no history error, but still returned the complete 21:00 UTC point. All ten database cache scopes remain tied to run 18927, published 21:20 UTC. This is availability evidence for one request, not scheduled collection recovery. No immutable archive read-back or full recovery is claimed.

No new repair attempt or production mutation was made; recurrence repair attempts remain zero. The managed database/Storage performance problem needs owner/platform investigation or an independently proven scoped fix. Sanitized evidence is in `followup-0129.json`. Original research/evaluation data and city collection were not changed.

## October 15, 02:32 heartbeat: fourth incomplete hour

The 01:00 run 19101 became partial at 02:00:09 UTC. All 72 batches are missed with zero attempts. Reconciliation now shows 176 expected operational slots, 161 complete, 14 partial, zero expired absent rows and zero expired running rows. This recurrence has four incomplete hours (22:00–01:00). Current 02:00 run 19139 has 72 queued batches with zero attempts and is allowed until 03:00 UTC. Both runs therefore consumed zero request/lookup budget; the current run is not yet a missed hour.

Collection remains enabled and continuous. Dispatch advanced to 02:32:09 UTC, while the last provider request remains October 14 at 22:06:23 UTC and the shared cooldown remains expired. Saved worker responses at 02:31–02:33 again show HTTP 503 database job-claim failures on all three fixed routes, with matching expected/actual regions. The main dispatch, watchdog, Trends cache, projection repair and retention schedules are all present and active, so schedule restoration is not applicable.

The full status read failed with management API HTTP 544, `Failed to run sql query`; the broader diagnostic exceeded its 60-second bound. Narrower queries succeeded: retention cron dispatch at 02:20 failed with `job startup timeout`, while 02:10 and 02:30 succeeded. A successful cron dispatch does not prove the asynchronous retention worker completed or that deletion eligibility is zero. Current archive capacity and retention eligibility remain unverified; capacity controls were not bypassed.

The public cache-only Trends request timed out at 25,007 ms. Database cache rows remain tied to complete run 18927 (21:00), ten scopes published at 21:20 UTC. A separate narrow query verified zero missing projection batches for that latest complete run. No new complete sweep or immutable archive recovery read-back is claimed.

No repair attempt, deployment, re-enable, provider replay, billing change, raw overwrite, research deletion or phone interaction was performed. Recurrence repair attempts remain zero. Sanitized evidence is in `followup-0232.json`; current diagnostics do not justify retrying the earlier rejected Storage-owner index change or weakening exact archive accounting.

## October 15, 03:33 heartbeat: fifth incomplete hour

The 02:00 run 19139 became partial at 03:00:07 UTC, with all 72 jobs missed and zero attempts. Reconciliation shows 177 expected operational slots, 161 complete, 15 partial, zero expired absent rows and zero expired running rows. Five incomplete hours belong to this recurrence (22:00–02:00); ten predate it. Current 03:00 run 19181 has 72 queued jobs with zero attempts and has until 04:00 UTC. Both latest runs consumed zero request/lookup budget; the current hour is not yet missed.

Collection remains enabled and continuous. Dispatch advanced to 03:33:00 UTC; last provider request remains October 14 at 22:06:23 UTC and the shared cooldown remains expired. Saved 03:31–03:33 responses show HTTP 503 `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED` on all three fixed routes with matching expected/actual regions. All required national schedules remain active; there is no missing main schedule to restore.

Retention cron dispatches at 03:10 and 03:30 failed with `job startup timeout`; 03:20 succeeded. Successful dispatch does not establish worker completion or zero eligible objects. The full status query again failed with SQLSTATE 57014 inside `fuel_national_archive_bytes` (management API HTTP 400). Current archive capacity and retention eligibility remain unverified. Exact capacity protections were not weakened.

Latest-complete projection backlog is zero. Database cache remains ten scopes for run 18927 (October 14, 21:00), published at 21:20 UTC. A cache-only public request returned that same history point with HTTP 200 and no history error, taking 21,786 ms. This slow response does not constitute collection recovery or fresh data. No immutable recovery read-back is claimed.

No new repair attempt or production mutation was made. Recurrence repair attempts remain zero. The persistent managed database/Storage performance failure still needs owner/platform investigation or an independently proven scoped repair; the prior Storage-owner permission rejection was not retried. Evidence is in `followup-0333.json`. Research/evaluation archives and city collection remain untouched by this monitor.

## October 15, 04:31 heartbeat: sixth incomplete hour; capacity read succeeds

The 03:00 run 19181 became partial at 04:01:08 UTC, missing all 72 batches with zero attempts. Reconciliation shows 178 expected operational slots, 161 complete, 16 partial, zero expired absent rows and zero expired running rows. Six incomplete hours belong to this recurrence (22:00–03:00). Current 04:00 run 19217 has 72 queued jobs and zero attempts and is allowed until 05:00 UTC. Both latest runs consumed zero request/lookup budget; the current hour is not counted as missed.

Continuous collection remains enabled. Last dispatch advanced to 04:31:00 UTC, while last provider request remains October 14 at 22:06:23 UTC. The shared cooldown expired at 22:04:16 UTC; the latest stored provider event remains the old transient GraphQL failure, with no newer provider denial in the returned events. All three fixed routes remain enabled, with zero completed batches in the two latest hours and no wrong-region jobs. All five required schedules, including main dispatch, watchdog and retention, remain active.

The worker-response query and initial maintenance query both failed during login-role creation with management API HTTP 544 database connection timeout. They do not provide fresh saved worker error bodies. However, the full status query eventually completed, and a narrower maintenance query subsequently succeeded. This is improved diagnostic access, not collection recovery.

Accounted archive usage is 722,646,481 bytes against 900,000,000. Retention candidates returned 200, the function's capped batch size, so at least 200 eligible objects were waiting at that snapshot; this is not an exact total backlog. The 04:30 retention cron dispatch failed with `job startup timeout`; 04:10 and 04:20 dispatches succeeded. Successful dispatch does not prove asynchronous cleanup completion. No manual deletion, capacity bypass, retention-policy change or research/evaluation-data mutation was performed.

Latest-complete projection backlog is zero. Cache remains ten scopes for run 18927 (October 14, 21:00), published at 21:20 UTC. The public cache-only Trends request timed out at 25,008 ms. No resumed scheduled collection or immutable recovery read-back is claimed.

No repair or production mutation was attempted; recurrence repair attempts remain zero. Existing permission and capacity safeguards remain intact. Sanitized evidence is in `followup-0431.json`. Managed database/Storage investigation is still needed; the failed owner-only index action was not repeated.

## October 15, 05:37 heartbeat: seventh incomplete hour

The 04:00 run 19217 became partial at 05:02:06 UTC, missing all 72 jobs with zero attempts. Reconciliation shows 179 expected operational slots, 161 complete, 17 partial, zero expired absent rows and zero expired running rows. Seven incomplete hours belong to this recurrence (22:00–04:00); ten predate it. Current 05:00 run 19249 has 72 queued jobs with zero attempts and is allowed until 06:00 UTC. Both latest runs consumed zero request/lookup budget. The current hour is not yet a missed hour.

Collection remains enabled and continuous. Dispatch advanced to 05:38:00 UTC, but the last provider request remains October 14 at 22:06:23 UTC and the shared cooldown remains expired. Saved worker responses at 05:33–05:36 show HTTP 503 database job-claim failures on all three fixed regional routes, with matching expected/actual regions. All five required schedules are active. The 05:10, 05:20 and 05:30 retention cron dispatches succeeded; this does not independently prove asynchronous deletion completion or a cleared backlog.

The full status read failed with SQLSTATE 57014 inside `fuel_national_archive_bytes` (management API HTTP 400). Current archive usage and retention eligibility remain unverified; the prior 722,646,481-byte usage and capped 200-candidate result are historical measurements, not fresh values. No capacity stop, retention rule, research/evaluation protection or permission boundary was changed.

Latest-complete projection backlog is zero. The database cache still has ten scopes for complete run 18927 (October 14, 21:00), published at 21:20 UTC. The public cache-only Trends request timed out at 25,009 ms. There is no scheduled recovery or immutable recovery read-back to report.

No repair attempt or production mutation was made; recurrence repair attempts remain zero. Managed database/Storage investigation or an independently proven scoped repair is still necessary. The previously rejected owner-only index action was not retried. Sanitized evidence is in `followup-0537.json`; no provider collection, city restart, raw overwrite, billing change or phone interaction was performed by the monitor.

## October 15, 06:37 heartbeat: eighth incomplete hour

The 05:00 run 19249 became partial at 06:00:00 UTC, missing all 72 jobs with zero attempts. Reconciliation shows 180 expected operational slots, 161 complete, 18 partial, zero expired absent rows and zero expired running rows. Eight incomplete hours belong to this recurrence (22:00–05:00); ten predate it. Current 06:00 run 19283 has 72 queued jobs with zero attempts and is allowed until 07:00 UTC. Both latest runs consumed zero request/lookup budget. The current hour is not counted as missed.

Collection remains enabled and continuous. Dispatch advanced to 06:38:09 UTC; the last provider request remains October 14 at 22:06:23 UTC and the shared cooldown remains expired. Saved 06:39–06:41 worker responses show HTTP 503 database job-claim failures on all three fixed routes with matching expected/actual regions. All five required schedules remain active. Retention cron dispatches at 06:20, 06:30 and 06:40 succeeded; dispatch success does not establish asynchronous cleanup completion.

The full status request failed with management HTTP 502 after login-role initialization. Current archive capacity and retention eligibility remain unverified; prior capacity measurements are not represented as current. No capacity guard, retention policy, permission boundary or original research/evaluation archive was changed.

Latest-complete projection backlog is zero. Cache remains ten scopes for complete run 18927 (October 14, 21:00), published at 21:20 UTC. The public cache-only Trends request returned HTTP 200 after 20,996 ms with the same old 21:00 history point and no history error. A successful stale-cache response is not resumed collection. No immutable recovery read-back is claimed.

No repair attempt or production mutation was made; recurrence repair attempts remain zero. Managed database/Storage investigation or a separately proven scoped repair remains necessary. The prior rejected Storage-owner index action was not retried. Sanitized evidence is in `followup-0637.json`. The monitor made no provider collection requests, city restart, billing change, raw overwrite, research deletion or phone interaction. Coverage remains fixed-inventory observations, not verified pump truth.
