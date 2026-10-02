# Provider connect-reset incident — October 2, 18:12 UTC

## Cause and scoped repair

Event 204 preserves the complete list of five provider GraphQL errors: `connect ECONNRESET` against the provider's internal station service, each with `INTERNAL_SERVER_ERROR`. HTTP status was 200, but the batch was correctly rejected rather than accepting partial data. No authentication/rate denial was present. Our transient classifier recognized `read ECONNRESET` and connect timeouts but missed the connect-reset variant. Event 205 therefore disabled nationwide collection and imposed the existing one-hour shared cooldown until **19:12:07.13661 UTC**.

The classifier now recognizes this narrow connection-reset variant. Unknown failures still require review, and any access/rate denial anywhere in a mixed response still takes priority. Existing bounded scheduled retries, request identity, regional routing, attempt caps, and Retry-After handling remain intact. No provider requests were made by this diagnosis.

## Validation and deployment

- 36 focused GraphQL, transport, region, and archive tests passed (`tests.tap`). Partial/error data is rejected with one transport request.
- Six live SQL rollback cases checked the recovery's time gate, eligible state, manual pause, newer denial, capacity stop, and newer shared cooldown. Existing SQL retry gates also passed, including attempt caps and access denials. Test transactions were rolled back; no collection was dispatched.
- Deployed to Virginia, Northern California, and Oregon workers (`deploy.log`). All six provider-free regional health/routing checks passed afterward.
- Immutable read-back samples from all three regions in run 2009 passed hashes, exact IDs, schema, and provenance checks (`archive-before-recovery.json`). These are pre-recovery successes, not proof of resumed collection or verified pump truth.

## Recovery scheduled at 18:31 UTC

At 18:31 UTC installed one incident-specific Cron action for **October 2 at 19:13 UTC** (3:13 PM Eastern), after the preserved cooldown. `resume-once.sql` unschedules itself, compares the exact incident state and evidence, refuses newer denials/recovery events or changed pauses/budgets, checks shared cooldowns and capacity, then re-enables the existing collector and invokes its existing watchdog. It never requests provider data itself, resets failed jobs, extends deadlines, or rewrites prices. This is repair attempt 1 for event 205.

At scheduling time the collector remained disabled before cooldown expiry. Actual resumption was **pending** (verified below by the next heartbeat). The verification plan was: inspect the recovery event/Cron outcome, verify that the 19:00 sweep progresses through existing schedules, and use `auditRegionalSample.mjs` for new successful archives (or `auditHour.mjs` after a complete hour). If a guard blocks recovery, inspect its saved reason rather than overriding it. Do not schedule a duplicate recovery.

## Coverage and capacity at diagnosis

- City campaign: 1,110 successes, 42 historical misses, no expired queued/running jobs. The 18:19 onward jobs are waiting on shared cooldown; city dispatch/watchdog remain active.
- National: 45 expected slots including the current hour; 32 complete, 7 historical partial, 5 expired unstarted, 1 current running. The 18:00 sweep has 55/72 successful batches, 107,960 observed IDs and 71,164 with prices. Its original 19:00 deadline precedes cooldown expiry, so its remaining batches cannot be recovered within that hour. Preserve that gap.
- All recent scheduled jobs succeeded; zero wrong-region jobs. Main schedules and watchdogs are present.
- Database: 340,552,851 bytes. Storage: 141,883,795 bytes. National archive accounting: 137,608,847 / 900,000,000 bytes. No capacity stop.
- Catalog remains 141,660 IDs in 72 fixed-region batches. Texas/DC geographic coverage assumptions and the Texas one-ID aggregate discrepancy are unchanged. Missing prices remain missing.
- National trends cache was last published from run 1889 (16:00). Projection timeouts remain recorded separately from raw archive success; this repair does not alter production ranking or projections.

## Recovery verified — 19:28–19:30 UTC

The guarded action ran successfully at 19:13:00 UTC, recorded event 228 (`USER_AUTHORIZED_CONNECT_RESET_RECOVERY`, attempt 1, original event 205), and removed its own schedule. Both collectors resumed through their existing Cron schedules. No newer authentication, rate, or unclassified GraphQL denial was recorded. A 19:24 HTTP 503 used its five-second cooldown and collection continued automatically.

New immutable archive samples from Virginia, Northern California, and Oregon in run 2022 passed read-back verification of SHA-256, exact station IDs, price schema, and regional provenance. All six provider-free regional checks passed. No wrong-region jobs or recent Cron failures were found. At the last partial-run snapshot, the 19:00 sweep had 71/72 batches with no missed batches and remained before its 20:00 deadline; this was normal progress, not a failed hour.

The 18:00 sweep expired with 55/72 batches preserved and 17 missing. City observations resumed after cooldown, but 12 queued observations expired at their unchanged 19:19 deadline; the total historical city misses increased from 42 to 54. There are no expired queued/running city jobs. At 19:28 the city campaign had 1,132 successes and no due backlog.

Coverage counted all 46 expected nationwide slots, including slots without run rows: 32 complete, 8 partial, five historical unstarted/expired, and the current in-progress hour at the snapshot. The five unstarted hours remain October 1, 08:00–12:00 UTC.

Database usage was 342,109,331 bytes; total object storage 145,291,380 bytes; national archives 141,016,432 against the unchanged 900,000,000-byte budget. The campaign deadline, catalog assumptions, raw observations, regional routing, and reserved final evaluation days are unchanged. Trends projection timeouts and the older published cache remain visible separately; no production ranking change was made.

No second repair attempt or deployment was necessary. Post-recovery status, schedule execution, regional checks, and archive read-back evidence are stored alongside this report. Verification concerns provider observations, not pump truth.

### Full recovery-hour audit

The 19:00 sweep subsequently completed. All 72 immutable batches passed full read-back verification at 2026-10-02T19:30:35.627Z: 141,660 unique catalog IDs, 94,973 with reported prices, 46,687 without prices. Archive bytes: 3,705,851. Regional station totals: {'us-east-1': 117700, 'us-west-1': 17747, 'us-west-2': 6213}. See `complete-recovery-hour-audit.json`. This moves nationwide coverage to 33 complete hours, 8 partial, and 5 historical unstarted/expired out of 46 expected slots.
