# November 7 database access incident

At 14:37 UTC, national collection was stalled and Supabase reads were failing. The last successful current-hour read showed run 51770 at 30/72 successful batches, with 42 queued, 31 provider attempts, and 59,960 attempted station lookups. The last request was 14:08 UTC. This hour has until 15:00 UTC and is not yet counted as an expired operational gap.

Scheduled east workers returned HTTP 503 with `DATABASE_CLAIM_FUEL_NATIONAL_REGION_JOB_FAILED`. The service and schedules remained enabled; the earlier transient provider cooldown had expired. The last complete cache is the 13:00 sweep, published at 13:15 UTC in all ten scopes. The known November 5 12:00 partial remains unchanged.

The standard status query and a bounded health query timed out with management HTTP 524. Later reads failed with HTTP 544 database connection timeouts, including login-role initialization. Two protected direct REST reads also timed out after 12 seconds each. A successful activity snapshot showed no blocking PIDs, but does not establish the root cause. Query planning alone did not justify a schema or statistics change.

No repair was attempted: there is insufficient evidence to select a safe targeted change. No provider collection, restart, re-enable, routing change, budget change, raw-price write, or research modification was performed. Retention and capacity could not be freshly verified after the full status read failed. Evidence contains no credentials or user identifiers.

Next check: restore protected read access, inspect current and expired slots including absent rows, diagnose saved worker/database errors, and verify automatic scheduled recovery. On recovery, verify complete cache/projection and immutable archive read-back before closing the incident. Do not replay this hour or bypass a newer denial or deliberate pause.

## 15:27 UTC follow-up

Run 51770 closed partial at 15:04 UTC with 30 successful and 42 missed batches. Run 51796 for 15:00 has 72 queued jobs and no attempts in the successful brief read; its deadline remains 16:00 UTC. The retained eight-day slot check reports two partial hours (including the known November 5 partial), zero expired absent rows, zero expired running rows, and a present current-hour row. Do not infer lifetime absence counts from aged-out metadata.

All six monitoring/collection/retention schedules remain enabled. The ten-scope cache remains run 51710, published 13:15 UTC. A retention worker returned HTTP 503 `NATIONAL_RETENTION_FAILED` at 15:10 UTC. This status attempt failed with SQLSTATE 57014 inside `fuel_national_retention_candidates`. Further definition/activity reads failed during login-role initialization with HTTP 544 connection timeouts. These symptoms identify affected paths, not a proven root cause or justification for bypassing retention/capacity checks.

The management project listing reports `ACTIVE_HEALTHY`, which does not establish service health. A browser fallback reached the existing-account sign-in page; dashboard resource metrics/server logs require sign-in. No credentials were entered or access changed. No repair attempt was made, and no collection was manually triggered. Current capacity and projection checks remain unverified. Sanitized follow-up evidence is in `followup-1527.json`.
