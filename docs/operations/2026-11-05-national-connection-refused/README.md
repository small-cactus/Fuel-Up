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
