# Provider connect-reset incident — October 2, 18:12 UTC

## Cause and scoped repair

Event 204 preserves the complete list of five provider GraphQL errors: `connect ECONNRESET` against the provider's internal station service, each with `INTERNAL_SERVER_ERROR`. HTTP status was 200, but the batch was correctly rejected rather than accepting partial data. No authentication/rate denial was present. Our transient classifier recognized `read ECONNRESET` and connect timeouts but missed the connect-reset variant. Event 205 therefore disabled nationwide collection and imposed the existing one-hour shared cooldown until **19:12:07.13661 UTC**.

The classifier now recognizes this narrow connection-reset variant. Unknown failures still require review, and any access/rate denial anywhere in a mixed response still takes priority. Existing bounded scheduled retries, request identity, regional routing, attempt caps, and Retry-After handling remain intact. No provider requests were made by this diagnosis.

## Validation and deployment

- 36 focused GraphQL, transport, region, and archive tests passed (`tests.tap`). Partial/error data is rejected with one transport request.
- Six live SQL rollback cases checked the recovery's time gate, eligible state, manual pause, newer denial, capacity stop, and newer shared cooldown. Existing SQL retry gates also passed, including attempt caps and access denials. Test transactions were rolled back; no collection was dispatched.
- Deployed to Virginia, Northern California, and Oregon workers (`deploy.log`). All six provider-free regional health/routing checks passed afterward.
- Immutable read-back samples from all three regions in run 2009 passed hashes, exact IDs, schema, and provenance checks (`archive-before-recovery.json`). These are pre-recovery successes, not proof of resumed collection or verified pump truth.

## Scheduled recovery, not yet verified

At 18:31 UTC installed one incident-specific Cron action for **October 2 at 19:13 UTC** (3:13 PM Eastern), after the preserved cooldown. `resume-once.sql` unschedules itself, compares the exact incident state and evidence, refuses newer denials/recovery events or changed pauses/budgets, checks shared cooldowns and capacity, then re-enables the existing collector and invokes its existing watchdog. It never requests provider data itself, resets failed jobs, extends deadlines, or rewrites prices. This is repair attempt 1 for event 205.

The collector remains disabled before cooldown expiry. Actual resumption is **pending**, and must be checked by the existing next heartbeat: inspect the recovery event/Cron outcome, verify that the 19:00 sweep progresses through existing schedules, and use `auditRegionalSample.mjs` for new successful archives (or `auditHour.mjs` after a complete hour). If a guard blocks recovery, inspect its saved reason rather than overriding it. Do not schedule a duplicate recovery.

## Coverage and capacity at diagnosis

- City campaign: 1,110 successes, 42 historical misses, no expired queued/running jobs. The 18:19 onward jobs are waiting on shared cooldown; city dispatch/watchdog remain active.
- National: 45 expected slots including the current hour; 32 complete, 7 historical partial, 5 expired unstarted, 1 current running. The 18:00 sweep has 55/72 successful batches, 107,960 observed IDs and 71,164 with prices. Its original 19:00 deadline precedes cooldown expiry, so its remaining batches cannot be recovered within that hour. Preserve that gap.
- All recent scheduled jobs succeeded; zero wrong-region jobs. Main schedules and watchdogs are present.
- Database: 340,552,851 bytes. Storage: 141,883,795 bytes. National archive accounting: 137,608,847 / 900,000,000 bytes. No capacity stop.
- Catalog remains 141,660 IDs in 72 fixed-region batches. Texas/DC geographic coverage assumptions and the Texas one-ID aggregate discrepancy are unchanged. Missing prices remain missing.
- National trends cache was last published from run 1889 (16:00). Projection timeouts remain recorded separately from raw archive success; this repair does not alter production ranking or projections.
