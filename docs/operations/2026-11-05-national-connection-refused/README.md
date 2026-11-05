# November 5 national internal-connection failure

At 12:08:44 UTC, event 5745 paused continuous national collection. Saved HTTP 200 response evidence for job 3511686 contains 157 INTERNAL_SERVER_ERROR entries. Of these, 155 were recognized connect ECONNRESET failures and two were connect ECONNREFUSED failures from the provider's internal station service. The latter caused the entire batch to be classified GRAPHQL_ERROR and disabled collection with a shared cooldown through 13:08:44.392184 UTC.

The 12:00 UTC sweep has 37/72 successful batches (east 24/59, southwest 9/9, northwest 4/4). Its deadline remains 13:00 UTC, so it is expected to expire incomplete. At diagnosis, all 191 earlier retained slots were complete. Trends serves the complete 11:00 sweep, published at 11:18 UTC. Budgets, projection backlog, archive capacity, and retention were healthy.

## Repair attempt 1

The classifier now recognizes only the observed internal station-service connect ECONNREFUSED message shape, subject to its existing extension-code allowlist. All errors must qualify as transient. Authentication/rate denial precedence and unknown-error stops still apply. The existing queue supplies bounded retries and shared cooldowns.

Validation: 37 tests passed across nationalGraphQLError, nationalPrices, nationalRegions, and nationalArchive. The regression uses the observed mixture of 155 resets and two refusals, checks denial/unknown precedence and Retry-After preservation, and verifies rejection of partial data with a single transport call.

Deployed to fuel-national-east, fuel-national-southwest, and fuel-national-northwest. All six provider-free live regional health and routing checks passed.

## Pending recovery

Cron job 30, fuel-refused-recovery-5745, is scheduled for November 5 at 13:09 UTC. The action unschedules itself and runs only within 13:09–13:15 UTC. It requires exact original config and saved response evidence, expired national and research shared cooldowns, available archive budget, and no national event newer than 5745. It re-enables only national collection and invokes the existing watchdog. Normal schedules perform subsequent collection.

A transaction-rolled-back dry run before the recovery window returned CONNECTION_REFUSED_RECOVERY_BLOCKED with reason Outside incident recovery window. After installation, live read-back confirmed enabled=false, unchanged cooldown, latest event 5745, and the active one-shot schedule.

Recovery is pending. On the next heartbeat, inspect the recovery event and schedule removal, count the expired 12:00 gap and any absent later slots, verify normal scheduled collection and latest complete Trends, and use auditRegionalSample.mjs for immutable archive read-back on the resumed run. Do not declare recovery from this deployment or schedule alone. Further repair attempts require fresh evidence and remain capped at three for this incident.

The closed research window, city campaigns, original research/evaluation archives, and fixed routing remain protected. Observations represent the fixed inventory and do not establish verified pump truth.

## Verified recovery at 13:27 UTC

The guarded attempt executed at 13:09:00.109692 UTC after the preserved 13:08:44.392184 cooldown. Event 5747 records attempt 1 for original event 5745. The one-shot schedule removed itself. At follow-up there were zero newer authentication, rate, or unknown GraphQL denials.

Normal scheduled collection completed run 48840 for 13:00 UTC at 13:25:15.147674. All 72 batches succeeded, with east 59/59, southwest 9/9, and northwest 4/4, zero wrong-region jobs, 141,660 fixed-inventory stations observed, and 92,671 stations with a reported price. Usage was 73 requests and 143,660 lookup attempts, within limits of 92 and 161,660.

Immutable read-back of one successful post-recovery batch from each assigned region passed checksum, exact station IDs, price schema, region, and provenance checks. The audit selected those samples while the sweep was still running; the subsequent health result independently establishes full sweep completion. This sample does not verify every archived object or real pump prices.

Trends published run 48840 across all ten scopes at 13:27:00.252908 UTC. Projection missing batches and pending operational repairs were zero. All six service schedules remained active. Retention had zero eligible objects and zero overdue derived runs; the worker returned HTTP 200. Archive accounting was 746,709,859 bytes and total Storage use 750,984,807 bytes, below the 900,000,000-byte archive budget.

The 12:00 UTC run closed partial at 13:00 with 37/72 successful batches and 35 missed east batches. The retained eight-day window contains 191 complete sweeps and this one incomplete hour, zero absent expired slots, and zero expired running slots. Previously aged-out operational history cannot be recounted from retained metadata alone. This incident added one incomplete operational hour. Repair attempts remain one. Recovery verification required no further deployment or provider collection from the monitor.

Evidence is recorded in after-recovery.json, recovery-checks.json, archive-after-recovery.json, and cache-after-recovery.json.
