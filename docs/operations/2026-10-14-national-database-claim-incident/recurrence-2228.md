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
