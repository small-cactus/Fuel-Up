# Completed-scan National caching — October 1, 2026

National chart and leaderboard results are now precomputed once per completed nationwide scan for all five grades and both E85 filters. A separate cache-only Cron checks for completion each minute. Publication verifies all expected archived batches and matching summary hashes, refuses a projection already touched by a newer partial scan, and atomically replaces all ten scopes. It does not collect data, change the collection window, or modify raw archives. The cache holds only the current ten results (19,183 bytes of JSON at verification).

The serving RPC is a single cached-row lookup. A response identifies its completed scan and the next hourly check time. The app reuses successful results for up to one hour, bounded by that completed-scan deadline; re-entering the screen five minutes later no longer fetches. A minute timer checks this deadline locally, without a request while valid. If the next scan is delayed, requests recheck the cached row at one-minute intervals until a new publication exists. Pull to refresh bypasses the client cache but still reads only the published server result.

The 24-hour raw-price rule remains enforced on both server and client. Expiry removes a price locally without fetching or estimating a replacement. This can temporarily leave fewer than five entries until the next complete snapshot; partial-scan replacements are intentionally not mixed in. Local/Home data flow is unchanged.

## Checks and deployment

- `npm run test:trends`: 30/30 before the added deadline/expiry case; the complete targeted National suite including that case then passed 7/7. Updated response metadata test separately passed 4/4.
- `npm run test:fuel-cloud`: 54/54. ESLint on changed app files and `git diff --check` passed.
- `tests/sql/completedNationalTrendsCache.sql` passed in a rollback transaction on the deployed DB: all ten cached outputs equal complete-scan queries, same-run publication is idempotent, partial runs and missing archive coverage cannot publish, a newer station projection cannot contaminate an older snapshot, missing cache scopes rebuild, and public/service permissions are restricted.
- Initial rollback test exposed Supabase's default service-role execute grant; the migration now explicitly revokes direct publisher/cache access. A later fixture variable ambiguity was fixed. No failed test fixture survived its transaction.
- Migration `20261001180000` applied and recorded; `gas-prices` deployed. Two automatic Cron executions succeeded, taking about 5 and 10 ms with the same already-published scan. Live endpoint returned scan 590, five prices, eleven history points, and a refresh deadline one hour after completion. See `live.json`.
- Endpoint timing sample retained in `timings.json`: median 565.5 ms over twelve requests, including network/edge overhead. This change removes repeated aggregation and client requests; these samples do not establish an additional end-to-end latency speedup over the preceding deployment.
- Release iOS build succeeded and was installed on the user's iPhone 18 Pro Max. The phone app was not opened. No visual component or native clustering code changed.

The history verifier now compares complete raw totals up to the cache's published scan, accounting for the publisher's legitimate one-minute lag. Monitoring includes the cache's scope count, run, publication time and Cron schedule.
