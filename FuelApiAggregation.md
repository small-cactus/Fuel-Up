# Gas price service

The app requests prices through the `gas-prices` Supabase Edge Function. GasBuddy is the only live gas provider. Existing GasBuddy rows in `station_prices` can fill the cache; there is no client-side provider fallback.

Project: `vjindchxfebaltbslqwc`, database region `us-east-2`. The project remains on Free. The public URL/key already in `app.json` authenticate app calls. The database service key stays inside Supabase, and the Mac repair secret is never shipped in the app or committed.

## Request path

1. The app keeps its existing local, spatial and trajectory caches (10 minutes). Legacy `all` provider preferences normalize to `gasbuddy`.
2. `src/services/fuel/remote.js` invokes `gas-prices`, specifying `us-east-2` and a 15-second client deadline.
3. The function returns a fresh `fuel_query_cache` hit with one database read. Keys include coordinates, radius and grade.
4. On a miss, an atomic 25-second refresh lease prevents duplicate GasBuddy requests for the same query. A competing refresh gets HTTP 503 with `Retry-After: 2`.
5. Recent GasBuddy cache-fill history can satisfy the query. Otherwise the function calls GasBuddy with a 6-second deadline, validates the response, applies the existing historical price and grade checks, and fills omitted stations from history.
6. Validated live rows are saved in `station_prices`. Server-generated rows use the reserved UUID `00000000-0000-4000-8000-000000000001`; it is not a user identity. Query results expire after 10 minutes; empty coverage expires after 60 seconds.

The function filters the final results to the requested radius. GasBuddy determines its own station search coverage, so a radius does not guarantee exhaustive coverage. Source timestamps remain attached to prices, including cache-fill and predicted prices.

The cloud and app share `core.js`, `priceValidation.js`, and `stationData.js`. Run `npm run fuel:build` after changing these; it produces the committed Deno modules. Existing pure legacy normalizers remain for compatibility, but no active request path calls another provider.

## Contract

`POST /functions/v1/gas-prices`, using the app's existing Supabase authorization:

```json
{"latitude":27.9506,"longitude":-82.4572,"radiusMiles":10,"fuelType":"regular","forceRefresh":false}
```

Response: `{ "version": 1, "source": "cache|cache-fill|live", "quotes": [...], "summary": {...} }`.
Supported grades: `regular`, `midgrade`, `premium`, `diesel`. `forceRefresh` is for explicit live diagnostics. Validation failures return 400; provider failures return 502; cache/refresh unavailability returns 503. HTTP errors, invalid JSON, GraphQL errors and schema changes count as provider failures. Legitimate empty coverage, invalid app input and cache outages do not.

## Mac repair

The database queues one job after at least five upstream failures in five minutes, when at least half of the requests in that window failed. It limits new incidents to one per hour and one active job. Job claims and updates require expiring lease tokens. All queue/cache tables and RPCs are restricted to `service_role`.

A private `fuel-repair` function serves claim/update requests using a separate random secret. `npm run fuel:repair:install` installs a launch agent at `~/Library/LaunchAgents/com.fuelup.repair.plist` and copies the worker to `~/Library/Application Support/FuelUpRepair`. Deleting the Desktop project does not delete this installed worker. The installer preserves its secret on reruns and uploads it through the Supabase CLI.

The launch agent checks the queue every five minutes while the Mac is logged in, awake and online. Idle checks do not start Codex. Jobs remain queued while the Mac is unavailable; this does not wake a sleeping or powered-off Mac. At continuous uptime the poller uses about 8,640 function invocations per 30 days, plus job heartbeats. This is a durable cloud queue consumed by the Mac, rather than an inbound connection to the Mac.

For a claimed job the worker:

1. Clones the backend files from the latest GitHub `master` into its private jobs directory and probes production. If all grades have recovered, it completes the job without Codex.
2. Otherwise runs the authenticated local `codex exec` with live web research, workspace write access and a 25-minute deadline. Only provider and validation code plus new regression tests may change. Existing tests, worker code, dependencies and infrastructure are protected by the supervising gate.
3. Runs the fixed backend contract/validation tests and new regression tests, regenerates shared modules, commits and pushes a repair branch.
4. Deploys `gas-prices-candidate`. It requires the private repair secret. Its probes read history but do not write production cache/history or incident counters. All four grades must return valid GasBuddy prices.
5. Fast-forwards `master` only if it has not changed, deploys production, and checks live prices, persistence and cache hits for all grades. On failure it redeploys the prior code and attempts a normal Git revert/push.

Jobs get up to three attempts, spaced by queue polls; a failed job remains visible with details in local logs. The worker cannot automatically solve missing account access, provider access restrictions, exhausted Codex limits or infrastructure changes outside its repair scope. If its lease expires it stops active child processes. It inherits the Mac's existing Codex model configuration and login. The installer requires CLI 0.158 or newer and can use the CLI bundled with ChatGPT when the shell CLI is older.

Worker status and logs:

```sh
launchctl print gui/$(id -u)/com.fuelup.repair
tail -50 "$HOME/Library/Application Support/FuelUpRepair/worker.log"
```

Per-incident clones and Codex logs are in the installed worker's `jobs` directory. Stop with `launchctl bootout gui/$(id -u)/com.fuelup.repair`. Reinstall after changing worker scripts. Credentials live only in mode-600 files inside a mode-700 application-support directory; CLI authentication uses its normal credential store.

## Deploy and verify

The existing database already has `station_prices`. Apply only the new migration to this existing project; do not blindly replay unrelated old migrations:

```sh
npx --yes supabase@2.118.0 db query --linked --project-ref vjindchxfebaltbslqwc --file supabase/migrations/20260928160000_gas_price_service.sql
npm run fuel:deploy
```

`npm run test:fuel-cloud` checks app/cloud integration, provider contracts, price validation, cache behavior and repair policy. `npm run fuel:probe` exercises actual GasBuddy requests and database persistence/cache reads for all four grades in Tampa. `tests/fuelRepairQueue.sql` checks the real database threshold, exclusive claims, retry/completion and privilege restrictions inside a rolled-back transaction:

```sh
npx --yes supabase@2.118.0 db query --linked --project-ref vjindchxfebaltbslqwc --file tests/fuelRepairQueue.sql
```

Free plan limits still apply. Cloud cache hits are function invocations; local app cache hits avoid the function. This is an initial deployment, not a load test for tens of thousands of users. Keep the plan free until there is an explicit decision to upgrade.

References: [Supabase regional invocation](https://supabase.com/docs/guides/functions/regional-invocation), [Codex non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode).

## Deployment verification (2026-09-28)

All four grades returned live GasBuddy prices and persisted successfully; follow-up requests returned cloud cache hits. Observed latency varied across runs (roughly 0.3 to 3.5 seconds), so this deployment does not establish an extremely low latency guarantee. The focused suite passes. Broader suites reproduce three failures on the unchanged prior commit: predictive camera heading continuity, rich-history cohort accuracy, and no-corridor miss classification. The iOS production JavaScript/Hermes bundle exports successfully. The actual app remote module returned prices from the deployed function, and a queued deployment smoke job was claimed and completed by the installed Mac worker. Native simulator/device verification and a real incident requiring a Codex-authored repair have not been performed.
