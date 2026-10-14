# National collection database-claim incident

Observed October 14, 2026, 05:19–05:24 UTC. The preceding monitoring failures began around 03:07 UTC.

The service remains enabled in continuous mode and its dispatch timestamp advances. Its last recorded provider request was 03:04:00 UTC; the shared cooldown expired at 02:16:48 UTC. All national cron entries remain active. No configuration, billing, collection, raw archive, or research-window data was changed by this investigation.

## Confirmed impact

- The 02:00 sweep is complete and is the latest published public Trends history point.
- The 03:00 sweep is partial: 18 succeeded batches and 54 missed batches out of 72.
- The 04:00 sweep is partial: all 72 batches missed, with zero attempts.
- The 05:00 sweep was still within its deadline, with 72 queued batches and zero attempts at the diagnostic snapshot. Do not count this as a missed hour yet.
- These are two newly confirmed incomplete operational hours beyond the four previously known partial hours. Full absent-slot reconciliation and current retention/capacity/backlog verification remain blocked by intermittent database query timeouts.

## Diagnosis

Saved pg_net responses show HTTP 503 with `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED` from all three fixed regional workers. Expected and actual regions match: us-east-1, us-west-1, us-west-2. This identifies a failure before the provider request claim succeeds, not a new provider denial. It does not identify the underlying database failure.

The administrative full status query repeatedly times out with HTTP 524. Some small read-only queries succeed; another diagnostic query returned HTTP 544 with a database connection timeout. A pg_stat_activity snapshot showed one active query, nine idle connections, and two extension waits; it did not establish persistent lock contention or exhausted connections. The public cache request first exceeded 25 seconds; a later request succeeded with the older 02:00 sweep.

## Action and limits

No speculative deployment, collection replay, re-enable, database restart, deletion, routing change, or billing change was attempted. The existing enabled schedule continues to retry through its normal controls. Repair attempts: zero. No recovery or immutable archive read-back is claimed. On recovery, verify scheduled collection, all operational slots, the latest complete cache, projection backlog, retention, budgets, and a stored immutable archive before reporting recovery.

Coverage remains observations of the fixed station inventory, not verified pump truth. Evidence excludes credentials and user telemetry.
