# Region-restricted nationwide collection

Implemented and deployed September 30, 2026, after the user selected broad US
areas matched to Supabase hosting regions. **Collection remains disabled.** This
changes where the new nationwide collector can execute; it does not resume the
rate-limited bootstrap or claim complete national inventory.

| Collector | Required runtime | Assigned states |
| --- | --- | --- |
| `fuel-national-east` | `us-east-1` — Northern Virginia | AL, AR, CT, DE, DC, FL, GA, IL, IN, IA, KS, KY, LA, ME, MD, MA, MI, MN, MS, MO, NE, NH, NJ, NY, NC, ND, OH, OK, PA, RI, SC, SD, TN, TX, VT, VA, WV, WI |
| `fuel-national-southwest` | `us-west-1` — Northern California | AZ, CA, CO, HI, NV, NM, UT |
| `fuel-national-northwest` | `us-west-2` — Oregon | AK, ID, MT, OR, WA, WY |

Supabase currently lists these three US Edge Function regions. There is no
listed Midwest or southern US Edge location, so those states are assigned to
Virginia. AK and HI are assigned to western hosts, not local in-state servers.
This is a fixed state-based partition, not per-station nearest-datacenter
optimization. See [official regional invocation documentation](https://supabase.com/docs/guides/functions/regional-invocation).

The existing `vjindchxfebaltbslqwc` project was verified `ACTIVE_HEALTHY`, with
its primary database in `us-east-2` (Ohio). That is the shared US East database;
no new projects, database copies, migration of production data, or read replicas
were created. Coordination queries and archive writes go to that central project.
The geographic restriction governs where station/price requests are initiated.

## Enforcement

1. The central database creates one hourly run and immutable batches partitioned
   by regional ownership. Every station has one regional owner. An ID appearing
   in two different hosting partitions rejects the catalog until the geographic
   conflict is reconciled. Same-region duplicates are fetched once.
2. Cron chooses a regional function and adds an explicit `x-region` header. It
   visits eligible regional queues in least-recently-dispatched order. Supabase
   documents that explicitly pinned invocations do not automatically reroute to
   another region during an outage.
3. Each function has its expected region fixed in its entry point. The shared
   handler compares that to the platform's `SB_REGION` before any database,
   Storage or provider work. Missing region: 503. Wrong region: 409. Caller JSON
   cannot override this check. Region outages leave jobs pending/missed; there
   is no alternate-region provider retry.
4. The database claim accepts the verified execution region and returns only its
   matching batches. The worker independently checks the returned job ownership
   before issuing a provider request. Runtime region is included in each archived
   snapshot and job provenance.
5. The old `fuel-national` catch-all returns 410 to authenticated requests and
   cannot contact the provider. The unscoped claim RPC was removed.

Supabase deploys function code globally; these controls restrict **execution and
outbound collection**, not the physical placement of every deployed code copy.
Neither runtime-region metadata nor the gateway response is a guarantee of the
third-party provider's processing location or every intermediate network hop.

## Coordination and scope

The shared database owns the hourly budget, global provider cooldown, idempotency,
leases, success counts and archive references. The previous single-provider-call
concurrency limit is retained. Regional hosting does not grant three independent
provider quotas or move throttled work to another origin. Cooldowns and explicit
access blocks continue to stop collection. A region is not allowed to take over
another region's jobs.

With batches kept region-pure, the count is `sum(ceil(regionStations / 2000))`,
up to two more requests than globally mixed batches. Performance remains
unbenchmarked against the provider at national scale.

This change applies to the **new nationwide collector**. The separate existing
24-city research campaign keeps its prior routing and schedule while the user's
follow-up scope question is pending. Its raw observations and seven-day deadline
are unchanged. Nationwide activation is still blocked by the incomplete catalog,
unknown sustainable provider budget, and archive-capacity review.

## Verification

- **37 Node tests passed**, including every wrong/missing runtime combination,
  exact 51-state/DC mapping, pure regional batching, ambiguous ownership rejection,
  same-region deduplication, authentication and job-owner checks.
- The real PostgreSQL rollback suite passed: regional partitioning into 38/7/6
  fixture stations, East cannot claim Alaska, a shared cooldown blocks West too,
  lease recovery, exact ID coverage, completion only after every regional batch,
  hourly idempotency, expiry, budgets and role restrictions. No synthetic data or
  test cooldown changes were committed.
- **Six live Supabase routing checks passed**: each of the three functions returned
  200 from its assigned runtime; deliberately pinning it to another US runtime
  returned 409 `WRONG_EXECUTION_REGION`. Both `SB_REGION` and `x-sb-edge-region`
  matched the requested physical execution region. These health-only checks
  made zero provider requests. See [regional-verification.json](regional-verification.json).
- All three correctly pinned workers also reached the shared database and returned
  200 with zero jobs from the paused queue. An unauthenticated regional call
  returned 401; the retired catch-all returned 410. See
  [regional-paused-smoke.json](regional-paused-smoke.json). All 51 live database
  state assignments were compared against the function ownership map and matched.
- The function wrapper, migrations and routing are deployed. Provider collection
  remains paused; this is not a successful nationwide price run.

```sh
node scripts/national-prices/status.mjs
node scripts/national-prices/verifyRegions.mjs /absolute/new-region-report.json
node --test tests/nationalRegions.test.mjs tests/nationalPrices.test.mjs tests/stateSnapshot.test.mjs tests/researchCollector.test.mjs
```

`verifyRegions.mjs` uses the existing protected local research key without
printing it. It only sends health requests. `publishCatalog.mjs` now uses the
regional planner, and the database independently validates/partitions the catalog.
The national collector's existing pause/configure command remains safe to rerun;
it neither activates collection nor restores the retired catch-all route.
