# Cold storage

Nationwide hourly raw history already lives as compressed, immutable objects in
the private `fuel-national` bucket. Keep current station locations, prices, radius
indexes, and published Trends summaries in Postgres so app requests stay small
and fast. Do not move the active city research snapshots or reserved holdout data.

The private `fuel-cold` bucket retains older legacy data:

| Source | Archive eligibility |
| --- | --- |
| `expired-query-cache` | Query caches expired more than one day ago |
| `legacy-station-prices` | Legacy observations created more than 30 days ago |

The app's legacy history readers request 14 days. The 30-day retention boundary
does not affect these reads. Discovery payloads stay in Postgres because catalog
reconciliation and existing research tools still use them.

## Archive

Requires an existing Supabase CLI operator login for project
`vjindchxfebaltbslqwc`. The default is a read-only plan:

```sh
node scripts/storage/archiveColdData.mjs expired-query-cache
node scripts/storage/archiveColdData.mjs legacy-station-prices
```

Append `--apply` to execute. Each batch is written to a new UUID object, downloaded
again, and verified using SHA-256 and exact database JSON text. Only then does a
transaction lock the original rows, recheck their hashes and eligibility, record
the manifest in `fuel_cold_archives`, and delete the verified database copies.
Concurrent edits abort the whole batch. Failed uploads/read-backs never remove
source rows. Failed deletions may leave an extra archive object; retain it until
reviewed. Never overwrite existing objects or restore archives over current rows.

The scripts cap cold storage at 50 MB and all recorded object sizes at 950 MB,
reserving the existing 900 MB national archive budget plus 50 MB free headroom.
These are conservative client-side checks, not a replacement for Supabase usage
monitoring. Run only one cold archival operator at a time. No provider calls,
collection retries, or new background schedules are created by these commands.

## Export and research replay

Export downloads each manifested object and validates its hash, row count, source
and size. It produces exact database JSON rows as NDJSON in a new private local
file; an incomplete export is removed on error. Archive files may contain legacy
user identifiers, so keep exports private and out of Git.

```sh
node scripts/storage/exportColdData.mjs legacy-station-prices /tmp/fuel-old-prices.ndjson
node scripts/fuelPriceBacktest.cjs --archive-ndjson /tmp/fuel-old-prices.ndjson --validate-input
node scripts/fuelPriceBacktest.cjs --archive-ndjson /tmp/fuel-old-prices.ndjson
```

The backtest combines the export with live database rows. Without the argument it
explicitly warns that it covers database history only. The exporter never changes
the database or published prices. `--validate-input` reports input and event counts
without running the expensive model replay.

## Physical database size

Deletion makes pages reusable but does not necessarily reduce the billed database
file size immediately. After archival, use Postgres maintenance in separate,
standalone commands. `VACUUM (FULL, ANALYZE)` can compact the small legacy tables
but takes an exclusive lock: keep this operation brief and outside active writes.
For the hot serving indexes use `REINDEX INDEX CONCURRENTLY` so normal reads and
writes continue. Do not run `VACUUM FULL` on active nationwide serving tables.
The migration lowers their autovacuum thresholds to reuse space sooner.

Checks: `node --test tests/coldArchive.test.mjs`.
