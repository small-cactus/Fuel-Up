# Nationwide hourly collection: deployed, disabled pending coverage and rate budget

September 30, 2026. **No nationwide hourly feed is running.** The resumable
Supabase queue, authenticated Edge Function, private archive bucket and minute
dispatcher are installed, with collection explicitly disabled. The dispatcher
makes no outbound HTTP calls in this state. The existing seven-day, 24-city
campaign is unchanged and still healthy (48 city-hours, 960 station observations,
zero missed jobs/errors at 19:44 UTC).

## What the latest experiment established

- Reusing station IDs is substantially cheaper than rediscovering geography on
  every refresh. The previous complete Florida run fetched 7,931 catalog records
  and all available reported prices in 22.303 seconds: one inventory request and
  four fixed-ID price requests. A repeated refresh needs only the four price
  requests. This does not mean every station has a reported price.
- New York, Washington and Georgia searches resolved to actual states and
  reported 5,356, 2,579 and 6,701 records. “District of Columbia, United States”
  instead resolved to a nearby coordinate search with 719 records and null
  country/region identifiers. Treating that as DC-only coverage would be wrong.
- Texas reports 15,271 stations, beyond the observed 10,000-result search window.
  Brand counts covered all 665 catalog brand IDs: 144 were nonempty, and their
  counts summed to 14,801. That sum is **not a distinct-ID count**, and brand
  enumeration alone cannot establish complete Texas coverage.
- Starting with the prior 10,000 Texas IDs and adding 120 complete brand
  partitions produced **12,681 distinct IDs**, still **2,590 short** of the
  provider's reported count. The next request returned **HTTP 429 at 19:35:48
  UTC**. All new probes stopped. No proxy, alternate client, account, or Supabase
  execution was used to continue the blocked experiment.
- There were 33 saved successful HTTP requests in this follow-up plus that
  rejected request. The older probe transport did not save its Retry-After
  header. That evidence gap is explicit; the new transport captures both numeric
  and HTTP-date Retry-After. The paused national configuration records a
  conservative one-hour cooldown, **not** a provider-confirmed reset time.
- The rate-limit threshold/window and whether it counts HTTP calls, resolver
  work, session/IP traffic, or another dimension remain unknown. Large GraphQL
  aliases reduce transport overhead but still perform individual station
  resolutions. A low POST count is not proof of an acceptable provider load.

See [probe-evidence.json](probe-evidence.json) for timestamps, request durations,
scope results, and reconciliation counts. No complete US station list was found.
The compressed `partial-texas-catalog.json.gz` retains the 12,681 known IDs,
120 completed brand partitions and 24 remaining nonempty brands. It is explicitly
marked incomplete and cannot be installed as a national catalog. This preserves
the useful discovery work without automatically retrying the denied request.

## Most efficient architecture

1. Establish a complete, dated station-ID catalog across all 50 states plus DC.
   Discover metadata separately, refresh that catalog daily, and reconcile every
   partition's count and IDs. Avoid moving price-sorted pagination. Texas and DC
   discovery remain unresolved; this commit deliberately does not invent a
   completeness claim or run an automated incomplete catalog refresh.
2. Each hour, freeze the catalog version and split its **globally deduplicated**
   IDs into batches of at most 2,000. Request only IDs plus all available grade,
   cash/credit price and original source timestamp fields. No hourly metadata,
   geographic overlap, or per-user duplicate fetching is needed.
3. Supabase Cron ticks once per minute. It creates at most one current-hour run,
   then invokes `fuel-national` only when there is work. Each invocation handles
   at most eight sequential batches within a bounded time window. A database
   lease prevents overlapping national provider calls. Crashed workers resume;
   missed hours stay visibly incomplete and are never backdated.
4. Compress raw responses into a private Storage bucket with immutable keys and
   checksums. PostgreSQL holds the catalog, jobs, source/observation times,
   completeness counts and archive references. A fenced commit publishes each
   artifact only after Storage confirms its upload. Raw observations, missing
   quotes and original timestamps are retained, with no price correction or
   production ranking changes.
5. Enforce separate HTTP and station-lookup budgets. Respect provider cooldowns;
   access denials or ambiguous GraphQL failures require review. An active
   research-campaign cooldown blocks national work; a future national denial
   also cools that campaign, so an existing collector does not become a fallback
   route around a denial. The bootstrap denial was local: the already-running
   city experiment continued independently and remained healthy.

Supabase documents [Cron plus pg_net invocation and Vault](https://supabase.com/docs/guides/functions/schedule-functions)
and [Edge Function limits](https://supabase.com/docs/guides/functions/limits):
150 seconds wall time on Free, 400 seconds on paid plans, 2 seconds CPU per
request, and 256 MB memory. The work is divided across invocations rather than
depending on one long-running national request. Large-batch CPU time in the
hosted worker has **not** been benchmarked yet; the live worker was tested only
while paused to avoid additional provider traffic after the denial.

## Request, time and storage estimates

US inventory size has not been measured. These are planning scenarios, not a
national benchmark or an approved provider quota.

| Catalog size | Price POSTs/hour | Station lookups/hour | Serial estimate | Minute-scheduled estimate |
| --- | ---: | ---: | ---: | ---: |
| 150,000 | 75 | 150,000 | 6m 15s | 9m 15s |
| 200,000 | 100 | 200,000 | 8m 20s | 12m 20s |

Assumptions: 2,000 IDs/request, three-second request time, two-second pause,
eight batches per invocation, no retry or cooldown, no material storage/DB/cold
start delay. Schedule estimates are approximately **10–15 minutes** in practice
under those assumptions, not a throughput promise. Sustainable throughput is
unknown after the observed 429. Inventory discovery adds separate daily work.

Florida's 7,931 price-only records used 3,109,693 bytes JSON and 229,072 bytes gzip
(about 29 compressed bytes/station). Extrapolating gives roughly 4.3–5.8 MB per
national hour, 104–139 MB/day, or 728–970 MB for seven days. Real data and batch
boundaries can differ. The installed collector has a conservative **500 MB
archive budget** and stops before exceeding its reserve; it is not sufficient
for those full-week scenarios. Storage capacity, retention and project usage
must be resolved before activation. No automatic raw-history deletion exists.
Failed/stale uploads can leave unreferenced immutable artifacts; these require
audited cleanup and may consume storage beyond published-manifest byte counts.

## Provider path for dependable nationwide operation

The consumer interface is not currently proven suitable for sustained nationwide
hourly collection. The most efficient transport would be a provider-supported
national snapshot or change feed, avoiding repeated per-station resolvers.

[OPIS advertises retail fuel price files delivered throughout the day](https://www.opis.com/product/pricing/retail-fuel-prices/).
[PDI describes Live Price Data through an API](https://pditechnologies.com/blog/explore-latest-fuel-convenience-offerings/).
These are concrete provider offerings to investigate, **not** confirmed access,
pricing, hourly nationwide completeness, or permission for Fuel Up redistribution.
No outreach or purchase was made. A supported feed could replace the fetch layer
without changing the run/coverage/archive design.

## Deployment and operation

- Project: `vjindchxfebaltbslqwc`.
- Migration: `20260930200000_fuel_national_queue.sql`, applied and recorded.
- Function: `fuel-national`, deployed with a dedicated server-side handler check
  using the existing research secret. No key is shipped to the app.
- Cron: `fuel-national-dispatch`, every minute, SQL returns without any network
  request while collection is disabled.
- Current state: `enabled=false`, no catalog, zero approved hourly station
  lookups; reason `BOOTSTRAP_HTTP_429_AND_INCOMPLETE_CATALOG`.
- No existing collector, app cache, Glass Lab code or production ranking changed.

```sh
node scripts/national-prices/status.mjs
node --test tests/nationalPrices.test.mjs tests/stateSnapshot.test.mjs tests/researchCollector.test.mjs
```

When actual discovery is complete, the catalog format is an array `regions`
containing `code`, `complete`, `coverageBasis`, `observedAt`, `expectedCount`, and
unique string `ids` for every state and DC. Coverage evidence must be reviewed;
setting a boolean alone cannot establish geographical completeness.

```sh
node scripts/national-prices/publishCatalog.mjs /absolute/reconciled-catalog.json
```

Publishing validates all 51 scopes, deduplicates globally and creates 2,000-ID
batches atomically. It **keeps collection disabled**. Activation is an explicit
admin configuration change after the actual provider lookup budget, complete
catalog, archive capacity, run end time and hosted performance are established.
Catalogs older than 24 hours stop new runs. No automatic daily catalog refresh is
implemented while discovery remains unresolved. `configurePaused.sql` is the
repeatable pause/configure operation, not an enable command.

## Verification

- 28 focused Node tests passed, including existing state/research regressions.
- A real PostgreSQL transaction test passed and rolled back all synthetic data:
  missing inventory rejection, disabled behavior, hourly idempotency, single
  active request, stale lease rejection/recovery, Retry-After preservation,
  exact ID coverage, duplicate completion, unpriced station accounting,
  expired-hour partial status, lookup budget guard and role restrictions.
- A Supabase default service-role function grant was caught by that test and
  explicitly revoked from admin-only catalog/scheduling functions before deployment.
- Deployed endpoint: unauthenticated POST returned 401; authenticated paused
  POST returned 200 with an empty results array. No provider calls were made.
- Three actual Cron executions at 19:47, 19:48 and 19:49 UTC succeeded under
  `postgres`; the queue still contained zero national catalogs and zero jobs.
  The private bucket has no end-user object access policies.
- Full national coverage, sustained hourly throughput, hosted full-batch CPU,
  and real pump-price truth remain **unverified**.
