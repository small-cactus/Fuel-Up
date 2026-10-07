# October 7, 22:32 UTC database stall

The continuous national monitor found run 9175 stalled at 47 of 72 batches.
Last successful provider claim was 22:09:43 UTC. Twenty-five jobs remained queued,
with no active lease. The current hour had not passed its 23:00 deadline; no
expired missing operational hour existed. The previous three operational hours
were complete. All three regional worker health checks and wrong-region guards
passed without issuing provider requests.

Saved pg_net responses showed repeated HTTP 503
`DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED` beginning 22:10, followed by
`NATIONAL_RETENTION_FAILED` at 22:20 and 22:30. Sixty-two national Cron executions
failed in the recent hour. The national and shared provider cooldowns had expired,
continuous collection remained enabled, and storage was below its 900 MB budget.
Trends still served the previous completed 21:00 sweep. The lightweight driving
research health endpoint returned 200, so not every request failed throughout.

A read-only database activity diagnostic could not create its temporary login
role: HTTP 544, connection terminated due to connection timeout. The authenticated
resource metrics endpoint returned 504. Therefore the observed failure is database
unavailability, but its exact trigger and contemporary swap/memory condition are
unconfirmed. Prior Nano memory-pressure evidence is not a new measurement.

## Recovery attempt 1

Initiated one project restart through the already authenticated Supabase dashboard
at approximately 22:37 UTC under existing recovery authorization. The dashboard
confirmed Restarting. No billing, compute size, collection enablement, provider
routing, budgets, deadlines, archive or ranking changes were made. No manual
provider collection was triggered and no attempt counters were reset. Original
errors are preserved. Fifteen focused retention/worker/regional tests passed.

Post-restart verification is recorded below when completed.

## Verified recovery and remaining limitation

PostgreSQL restarted at 22:41:37 UTC. Both the project API and dashboard reported
healthy by 22:42; 14 database connections and no waiting locks were observed.
The 96 MiB shared-buffer setting was preserved. Cron dispatcher executions resumed
successfully without manual provider collection or re-enabling the collector.

The first post-restart batch was archived at 22:42:05. A subsequent provider HTTP
502 produced the normal 60-second cooldown; this was honored, not cleared. Normal
scheduled retries progressed to 51/72 successful batches by 22:44:33, with zero
missed batches and no expired missing operational hour. A later transient HTTP
503 also used its recorded bounded cooldown. Full-hour completion is not claimed
in this recovery snapshot; 21 batches were still pending before the 23:00 deadline.

Immutable sampled read-back passed hashes, exact inventory IDs, price schema and
regional provenance for one successful batch from each fixed region. The Virginia
sample was collected after restart; the two western samples predated restart
because their assigned work was already complete. These are provider observations,
not verified pump prices, and a sample is not a whole-hour audit.

Public local prices and national Trends returned HTTP 200 in 1,385 ms and 763 ms.
Local results contained 30 priced stations under the unchanged reported-last-24-
hours rule; national Trends used the last completed hour with 106 history points.
Authorized maintenance returned 200 with zero deleted objects, zero removed hours
and zero provider requests. Existing research data remains preserved.

The 15-second metrics sample did not advance and is explicitly inconclusive.
A subsequent advancing 61.3-second sample still measured 477 MB of swap-in,
418 MB of swap-out and 21.0% CPU IO wait (4 KiB page conversion). This is evidence
of ongoing resource pressure, not proof that it alone caused the original stall.
No new OOM kill was observed in that post-restart interval. A restart restores
service but does not resolve the recurring Nano capacity limitation. The user
previously declined a paid upgrade; no billing change was made.

Continuous monitoring remains active. This incident used one recovery attempt;
no code change or deployment was necessary. `recovered.png` captures the dashboard
health after recovery. The check of the phone app was entirely server-side; no
phone launch or visual app QA was performed.
