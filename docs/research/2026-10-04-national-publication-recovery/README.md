# National leaderboard publication recovery — October 4, 2026

## Cause and impact

At 22:24 UTC, nationwide collection had completed run 4996 (22:00 slot, 72 batches, 141,660 IDs), but all ten app scopes still served run 4121, published at 07:17 UTC. As source reports in that old snapshot exceeded the existing 24-hour freshness limit, the endpoint removed them. The actual endpoint returned regular 3, midgrade 2, premium 2, diesel 2, and E85 4 quotes.

Collection persisted immutable archives before attempting optional app publication. Some publication calls exceeded the five-second client deadline and never produced their trend-batch summaries. The cache publisher requires all 72 hash-matched batch summaries; recent runs had only 66–71. Its Cron execution could succeed while the publication function returned false. There was no durable retry of the deferred publications. The original timeout events remain intact. Exact SQL-level causes of the slow optional writes were not established.

Earlier monitoring checked collection completion but did not catch stale app publication. The status command now reports cache age, whether it trails the latest complete run, missing projection batches, and retry state.

## Repair

Deployed `fuel-national-projector` and migration `20261004224000_retry_national_projection.sql`. Every minute, a protected scheduled worker can claim one missing app publication from the latest completed national run. It pauses while a national collection run is active, serializes work through a two-minute fenced lease, and limits each batch to six replay attempts with bounded backoff. These are data replay retries, not six code/deployment repair attempts; this incident used one tested implementation.

The worker downloads existing immutable Storage objects and verifies compressed size, SHA-256, schema, exact inventory IDs, original timestamps, regional provenance, and priced-station count before passing the unchanged archived station records to the existing publication function. It makes zero provider requests and does not modify research leases, budgets, deadlines, fixed routing, raw archives, freshness filters, or ranking policy.

Job 357902 recovered automatically at 22:32:06 UTC. Two protected manual worker invocations recovered jobs 357903 and 357938 at 22:32:42 and 22:32:47. Each succeeded on its first attempt. The next invocation was idle. All three archive read-backs passed the worker's mandatory validation. The ordinary cache publisher published run 4996 at 22:33:00 UTC.

## Verification

- Five focused worker tests and eleven related archive, publication, leaderboard, and lifecycle tests passed (16 total).
- Real database transaction assertions passed for protected permissions, exclusive claim, lease-token fencing, incomplete-publication rejection, and failure backoff; test mutations rolled back.
- Deployed migration recorded as applied; worker deployment succeeded.
- At 22:34 UTC, all five fuel grades matched fresh indexed raw database station IDs, prices, and source timestamps exactly. No estimates were used.
- At 22:38 UTC, all ten combinations of five grades and the E85 requirement returned five quotes, scan 4996, and no history error.
- Final status: all ten cache scopes current, zero missing projection batches, all three repairs complete without errors, national run 4996 complete in its assigned regions, and city collection active with no overdue queued jobs.

Phone UI was not opened. Verification covers the deployed database, scheduled repair, immutable archive read-back, and public app endpoint. Prices remain provider reports, not verified pump truth. Older incomplete app projections are preserved; automatic repair prioritizes the latest complete run rather than rewriting historical research data.
