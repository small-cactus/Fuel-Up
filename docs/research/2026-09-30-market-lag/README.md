# Market-lag research and seven-day hourly collection

The server-side collection is active in Fuel Up Supabase project
`vjindchxfebaltbslqwc`. Campaign: `hourly-24-cities-20260930-v1`.
Start: **September 30, 2026, 2:19 p.m. Eastern**. End: **October 7, 2026,
2:19 p.m. Eastern** (18:19 UTC both dates).

24 cities × 168 hourly slots = **4,032 planned city-hours**. Each city has a fixed
minute offset in the hour to spread load. Cities: New York, Los Angeles, Chicago,
Houston, Phoenix, Philadelphia, San Antonio, San Diego, Dallas, Austin,
Jacksonville, San Jose, Fort Worth, Columbus, Charlotte, Indianapolis, Seattle,
Denver, Boston, Washington DC, Miami, Atlanta, Las Vegas, and Tampa.

## Durable collection

- Supabase Postgres Cron dispatches due work each minute; a separate five-minute
  watchdog restores a missing/inactive dispatcher. Neither requires this chat,
  a phone, nor an awake laptop. Cron runs as `postgres`, with no expiring CLI login.
- Each short Edge Function invocation leases at most two city-hour jobs. A killed
  worker's lease expires after two minutes, allowing a later worker to recover it.
- Writes atomically save the snapshot and finish its job; unique job/snapshot keys
  and token checks prevent duplicate or stale-worker completion.
- Exponential retry, at most six attempts within a slot. Provider `Retry-After`
  triggers a campaign-wide cooldown; 429 defaults to 15 minutes, 403 to one hour.
  No rate-limit or access-control bypasses. Other city slots continue after recovery.
- A missed deadline is recorded as missing. A later fetch is never backdated to
  manufacture a lost historical observation. At seven days, collection completes
  and unschedules its two Cron jobs; stored data remains.
- Research tables have RLS and no anonymous/authenticated-user access. Worker uses
  a dedicated server secret, with scheduler credentials in Supabase Vault. An
  unauthenticated live request returned 401. Existing app prices/cache are untouched.
- An additional hourly Codex heartbeat monitors health and reports meaningful
  failures/growing gaps or completion. It is not the collection engine and does
  not duplicate provider calls. Monitoring ends after this campaign.

The design recovers from routine failures; no service can guarantee zero gaps
during provider or platform outages. Coverage and failures remain explicit.
The provider's exact quota is not established; normal scheduled load is 24
requests/hour, staggered one minute apart, and throttling is respected.

## What is saved

One direct provider request per city returns its provider-selected first page of
stations (20 in initial successful runs). Store station ID, name, brands,
coordinates, **every returned fuel grade**, cash/credit amount and each payment's
own report timestamp, plus actual request start/observation times and intended
slot. No app correction, grade timestamp substitution, or query-cache fallback
is applied. Exact repeated observations are retained to measure timestamp churn;
they must be deduplicated when counting statistical evidence.

This is a consistent city search panel, not complete city coverage or a promise
of observing the same station IDs forever. Missing stations remain missing.
These remain crowd reports, not verified pump prices or proven misconduct.

Early validation: the first ten automatically scheduled city requests saved
200 station observations with zero failures/missed slots. Multiple Cron executions
and HTTP 200 responses were observed. At that point the snapshot table occupied
90,112 bytes including indexes/TOAST, and the database was about 38 MB; these
early figures are not a guarantee of final storage. See the timestamped
[health snapshot](collection-status.json) for later checkpoint coverage.

## Approach being tested

The first causal estimator compares a station's own historical price with matched
nearby price changes, using brand medians so many same-chain stations cannot
manufacture corroboration. It preserves the station's historical discount,
requires broad coherent price movement, ignores timestamp-only refreshes as
proof of freshness, and never lowers a legitimate high quote. Insufficient
evidence returns the raw quote plus a reason, not an invented correction.

The second candidate retains two scenarios: the low quote is genuine, or it has
lagged behind the market. For a scenario interval [L,U], the midpoint minimizes
worst absolute price error *within that assumed interval*. For choosing a station,
the candidate minimizes worst-case extra cost against the other eligible stations:
`max(0, upper_i - min(other lower bounds))`. Those intervals are uncalibrated;
the mathematics does not turn them into guaranteed bounds on pump prices.

## Findings so far

On the earlier 464 labelled candidate observations, v1 made **zero adjustments**:
the archive lacked sufficient history or coherent upward movement. It therefore
matches raw quotes (2.75¢ overall error; 13.29¢ worst-5% mean), versus current
rules at 6.76¢ and 34.51¢. That is avoidance of damaging adjustments, **not evidence
that the new approach successfully identified real stale low quotes**.

Seeded synthetic stress tests cover 500 scenarios with explicit simulated truth:
stale quotes with refreshed timestamps, genuinely held prices, stations tracking
their market, flat markets, and falling markets. They expose the crucial tradeoff:

- V1 reduces a planted stale station's average error from 73.43¢ to 18.36¢, but
  introduces 54.18¢ average error when a station genuinely holds its low price.
  Its latter family's worst-5% selection-regret mean is 52.17¢/gallon. It fails
  the genuine-bargain protection requirement and is not promoted.
- Scenario-midpoint estimates halve that planted stale error to 36.72¢ while
  lowering genuine-held-price damage to 36.12¢ relative to v1. They still worsen
  those genuinely held quotes compared with raw prices; no overall win is claimed.
- Minimax selection reduces the held-price family's maximum extra cost from
  53.81¢ under v1 to 16.97¢. The stale family's worst-case extra cost remains 18¢.
  This is a better ambiguity tradeoff in these fixtures, not verified real-world
  accuracy and not a guarantee under other price dynamics.
- Both candidates leave the tracking, stationary, and falling-market control
  families unchanged. Future observations, duplicate peers, same-chain movement,
  and wrong fuel/payment categories cannot supply supporting evidence in tests.

The second candidate was added after seeing v1's counterexample. All these stress
results are development diagnostics, not untouched test results. The scenario mix
and numeric truth are synthetic. [Full results](benchmark.json) retain both the
benefits and failures. **No experimental estimator has been deployed into app
prices, coloring, or recommendations.**

## Next evaluation and promotion gate

The [protocol](../../../scripts/price-model/MARKET_LAG_PROTOCOL.md) reserves days
1–3 for training/features, days 4–5 for choosing settings, and days 6–7 as the
untouched final period after selection is frozen. Evaluate the average extra cost
in the worst 5% of recommendations, severe false-cheap winners, price tail error,
overall error, and genuine-bargain displacement. Keep missing-label rates visible.

Hourly observations let us separate unchanged-price timestamp churn from actual
amount changes and measure a station's lag relative to independent peers. They
cannot establish contributor location or guaranteed truth. Later reports remain
proxies. A model must improve tails without material ordinary-price or genuine-
discount damage before changing production. There is no defensible claim of a
physically optimal predictor from this one provider's incomplete reports.

## Operations and reproduction

```sh
node scripts/price-model/statusCollection.mjs
node scripts/price-model/exportCollection.mjs /absolute/new-output.json.gz
node --test tests/researchCollector.test.mjs tests/marketLag.test.mjs tests/robustMarketChoice.test.mjs
node scripts/price-model/benchmarkMarketLag.mjs docs/research/2026-09-30-price-model /tmp/market-lag-results.json
```

The exporter uses a fixed database save-time cutoff, pages all snapshots, and
writes gzip without loading the entire campaign into memory. Existing output
files are not overwritten. Export was verified against seven stored snapshots.

Deployment consists of migration `20260930190000`, function `fuel-research`, then
`node scripts/price-model/installCollection.mjs`. The installer is idempotent for
this campaign and does not extend its end date. Its credential is kept outside
the repository in the user's protected Application Support directory and Vault.
The migration is recorded as applied in Supabase migration history.

The real database transaction test verified 4,032 slots, idempotent initialization,
expired-lease recovery, stale/duplicate callback rejection, atomic snapshot
persistence, provider-wide cooldown, missing-hour records, and denied public
permissions; all test data was rolled back before activation. A further live
transaction removed the dispatcher, invoked the watchdog, confirmed restoration,
and rolled back, leaving the running campaign unchanged. This verifies recovery
logic, not immunity to a whole-platform outage.

Supabase reference: [scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
and [runtime limits](https://supabase.com/docs/guides/functions/limits). The worker
awaits bounded work rather than relying on an indefinitely running Edge instance.
