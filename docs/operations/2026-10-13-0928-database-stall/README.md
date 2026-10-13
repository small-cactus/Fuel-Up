# October 13 09:28 UTC database stall

The preceding 08:29 check verified the 08:00 sweep and all ten Trends scopes complete, 130 complete operational hours plus four previously reported partial hours, no absent/expired running slots, and healthy retention and budgets.

## Failure evidence

- The 09:28 protected status query failed with PostgreSQL `57014`, statement timeout inside `fuel_national_archive_bytes`.
- The supplemental protected query failed with HTTP 524. A sequential full-status retry also failed with HTTP 524. A smaller job/cron query exceeded its 60-second client deadline.
- A lightweight read at 09:32:22 UTC succeeded intermittently: continuous collection remained enabled, the provider cooldown was expired, run 16929 (09:00) remained running, and the latest recorded request was 09:08:08 UTC despite a newer dispatch timestamp. All ten published cache scopes still referenced the complete 08:00 run 16869. Dispatch timestamps alone do not prove resumed collection.
- The refreshed Supabase project dashboard reported **Unhealthy**, **Database not usable**, and TCP `CONNECT_TIMEOUT` after 5002 ms. Its connection metric was unavailable. The dashboard's resource percentages do not establish the cause of the failure.
- The public status page listed Realtime latency and Edge Function deployment degradation under monitoring; this does not establish either as the cause of this project's database failure.

## Recovery attempt 1

All 23 focused regional-routing, GraphQL-error, and retention tests passed (see `tests.log`). One project restart was requested through Supabase Settings at approximately **09:35 UTC**, under the standing repair authorization. The dashboard acknowledged **Restarting**.

No collector activation, billing, provider budget, routing, identity, research boundary, retention policy, or raw observation was changed. No manual provider collection was invoked. No source repair or deployment was justified by the available evidence.

Recovery verification is pending. Restart acknowledgment alone does not establish service recovery, completed collection, or archive integrity. The 09:00 sweep has until 10:00 UTC; it is not yet counted as a missing operational hour.
