# Continuous nationwide app feed — October 7, 2026

The user authorized indefinite nationwide continuation because the app's nearby
prices and Trends depend on this feed. The completed research campaign remains
closed. Continuous operation is separate from its original measurement window.

## Deployment and operation

- Applied `20261007194000_continuous_national_service.sql` atomically to project
  `vjindchxfebaltbslqwc`, then deployed `fuel-national-retention`.
- Explicit activation at 19:33 UTC enabled continuous operation starting with the
  19:00 hour. The normal Cron dispatcher started run 9029 at 19:34 UTC.
- No provider requests were made by activation, monitoring, retention or archive
  audits. Collection remains exclusively scheduled through the existing workers.
- The main schedule runs every minute, its watchdog every five minutes, and
  retention every ten minutes. Hourly collection has no scheduled end date.
- Existing fixed inventory: 141,660 IDs in 72 batches through Virginia,
  Northern California and Oregon. Continuous mode reuses this inventory; it does
  not rediscover new stations or claim a newly verified nationwide census.
- Original research start/end/catalog dates are unchanged. City collection
  remains stopped. Original research archives and held-out final two days are
  protected by explicit timestamp boundaries in SQL and the maintenance worker.
- Current plan, 900 MB archive budget, hourly 161,660 lookup / 92 request budgets,
  ten-second pacing, shared cooldowns and provider-denial stops are unchanged.
  Operational incidents can still stop collection; indefinite means no planned
  campaign deadline, not bypassing safety or capacity checks.

## Retention

Only operational objects whose hour deadline is more than 48 hours old are
eligible. Deletion uses the Storage API, never direct Storage metadata deletion.
The latest published Trends cache archive and active projection leases are
protected. Reconciliation marks only proven absent archives and repairs partial
maintenance attempts safely. Eight days of operational run/job/derived-history
metadata are retained for the seven-day chart. Live serving references are
protected; compact failure-event evidence retains original job/run IDs.

Retention is limited to 200 objects and four old metadata hours per invocation.
The original research archive is approximately 570 MB; at the observed roughly
3.7 MB/hour, the rolling operational raw window should add about 180 MB. This is
an estimate, not a new budget authorization. Capacity monitoring remains active.

## Verification

- `tests.tap`: 49 passing relevant Node tests, including boundary validation,
  authentication, Storage failure, retry reconciliation and existing collector
  behavior.
- `database-tests.json`: live database tests inside a rolled-back transaction
  cover continuous hourly creation, idempotency, pause/cooldown/capacity gates,
  bounded research-mode behavior, cache protection, operational retention,
  original research protection and preserved error linkage. Future-time fixture
  overrides and synthetic rows were rolled back.
- `maintenance-live.json`: deployed endpoint rejects unauthenticated requests
  with 401; authorized idle maintenance returns 200 and deletes zero objects.
  Real operational expiry has not occurred yet; the first eligibility is after
  October 9 at 20:00 UTC.
- `activation.json`, `after.json`, `running.json`: activation and scheduled
  progress. At 19:36 UTC, run 9029 had 11 successful batches and no missed batches.
- `regional-readback.json`: immutable successful batch read-back from each of the
  three assigned regions, with matching hashes, exact IDs and provenance. This
  samples the ongoing first operational hour; it is not full-hour completion.
- `app-serving.json`: live local and national cache endpoints returned HTTP 200.
  Nearby response included newly collected 19:36 observations; national Trends
  served the last completed sweep with 103 history points while the new sweep
  was still running. Existing observed-price policy is unchanged.
- Hourly heartbeat `monitor-fuel-up-continuous-national-prices` is active for
  consequential incidents and recovery only. It counts absent operational hours
  separately from current progress and preserves already-reported research gaps.

Coverage retains the documented Texas and DC geographic assumptions and Texas's
one-ID aggregate discrepancy. Missing/stale prices remain missing, and provider
observations are not verified pump truth. No phone build is necessary for this
server-side change, and the phone app was not opened.
