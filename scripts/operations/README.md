# Database pressure checks

`node scripts/operations/databasePressure.mjs 60` reads two authenticated Supabase resource snapshots. It prints RAM/swap capacity, swap page deltas, major faults, CPU IO wait and disk deltas, without persisting credentials or reading provider/user data. Missing counters, restarts and cached/non-advancing samples are inconclusive, not healthy zeros. Snapshot caching means the wall interval may not equal the exact source scrape interval; use repeated independent intervals for conclusions.

## Fuel Up Nano memory configuration

On October 5 the Free/Nano host reported 411 MiB physical RAM, while the default PostgreSQL shared cache was 224 MiB. Heavy measured OS swap churn persisted after the trend-query spill mitigation. The user declined a paid plan upgrade. We applied a scoped 96 MiB shared-cache override to leave more space for other database processes and Supabase services:

```sh
npx --no-install supabase@2.118.0 postgres-config update \
  --project-ref vjindchxfebaltbslqwc --experimental --config shared_buffers=96MB
```

This changes server configuration and automatically restarts PostgreSQL; it is not a diagnostic command. Other overrides must be preserved (do not use `--replace-existing-overrides`). The saved pre-change overrides were empty. Verify `pg_settings.shared_buffers = 12288` with unit `8kB`, `pending_restart=false`, the postmaster start time, Home responses, scheduled collection and resource metrics.

Rollback to Supabase's generated default, **only if verification shows a regression**:

```sh
npx --no-install supabase@2.118.0 postgres-config delete \
  --project-ref vjindchxfebaltbslqwc --experimental --config shared_buffers
```

Rollback also restarts PostgreSQL. This override is specific to the current Nano host; review/remove it if compute is resized. It is not a guarantee against all future resource exhaustion. Do not disable collectors, alter research deadlines, weaken price policies or trigger extra provider collection as a pressure test.

Evidence: `docs/research/2026-10-05-database-memory-pressure/`.
