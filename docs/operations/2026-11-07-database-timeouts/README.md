# November 7 database access incident

At 14:37 UTC, national collection was stalled and Supabase reads were failing. The last successful current-hour read showed run 51770 at 30/72 successful batches, with 42 queued, 31 provider attempts, and 59,960 attempted station lookups. The last request was 14:08 UTC. This hour has until 15:00 UTC and is not yet counted as an expired operational gap.

Scheduled east workers returned HTTP 503 with `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED`. The service and schedules remained enabled; the earlier transient provider cooldown had expired. The last complete cache is the 13:00 sweep, published at 13:15 UTC in all ten scopes. The known November 5 12:00 partial remains unchanged.

The standard status query and a bounded health query timed out with management HTTP 524. Later reads failed with HTTP 544 database connection timeouts, including login-role initialization. Two protected direct REST reads also timed out after 12 seconds each. A successful activity snapshot showed no blocking PIDs, but does not establish the root cause. Query planning alone did not justify a schema or statistics change.

No repair was attempted: there is insufficient evidence to select a safe targeted change. No provider collection, restart, re-enable, routing change, budget change, raw-price write, or research modification was performed. Retention and capacity could not be freshly verified after the full status read failed. Evidence contains no credentials or user identifiers.

Next check: restore protected read access, inspect current and expired slots including absent rows, diagnose saved worker/database errors, and verify automatic scheduled recovery. On recovery, verify complete cache/projection and immutable archive read-back before closing the incident. Do not replay this hour or bypass a newer denial or deliberate pause.
