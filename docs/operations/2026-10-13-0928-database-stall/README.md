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

## Recovery verification

- PostgreSQL restarted at **09:39:30.259 UTC**. The dashboard subsequently reported Healthy, and protected status queries returned successfully.
- At 09:40:42, scheduled collection had advanced from 38 to 41 successful batches, with a new observation at 09:40:31. By the 09:43 status snapshot it had reached **43/72 batches**, with a subsequent request in flight. No manual dispatch was invoked.
- Immutable archive read-back passed SHA-256, byte size, schema, exact catalog IDs, observation timing, priced counts, and region provenance for one batch from each fixed route. The east sample was observed at **09:40:48**, after restart. Both western samples predate the incident because those routes had already completed. This is sampled archive verification, not a complete-sweep audit or verified pump truth.
- The public Trends endpoint returned HTTP 200 from `national-cache` in 1,121 ms at 09:41:54. All ten scopes still correctly referenced the latest complete 08:00 sweep (16869); the 09:00 sweep was incomplete.
- All five required schedules were active, with no national cron failures after database restart. Retention succeeded at 09:40, and no raw objects were currently eligible for deletion. The city campaign remained complete, continuous national collection enabled, and provider cooldown expired.
- At 09:43, the hour had consumed 44 attempts / 85,960 lookups, below limits of 92 / 161,660. Accounted archives were 739,908,834 bytes against the 900,000,000-byte cap. All three fixed routes had zero wrong-region jobs.
- Operational slot accounting remained 130 complete hours, four previously reported partial hours, one current running hour, and no expired absent/running slots. The two unfinished projection repair records remain confined to October 5 research data. The latest complete sweep had zero missing projections; current-run deferred serving events are not proof of a complete published 09:00 cache.

One restart was used. No source deployment was needed. Protected reads, scheduled collection progress, sampled immutable archives, the Trends response, and retention were verified recovered. The current sweep still has until 10:00 UTC; **whole-hour completion is not claimed**. The underlying cause of recurring database unavailability is not established, and the restart is not a permanent fix. Monitoring continues.
