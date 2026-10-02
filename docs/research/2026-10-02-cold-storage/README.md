# Cold archival and database space recovery — October 2, 2026

Project: `vjindchxfebaltbslqwc`. Applied migration
`20261002045000_cold_storage_archives`; recorded it in remote migration history.

At 04:53 UTC, actual Postgres database size fell from **348,032,147 bytes to
294,382,739 bytes**: **53,649,408 bytes reclaimed**. These are physical database
sizes, not just estimates of deleted row payloads. Dashboard usage may lag.

| Relation | Before bytes | After bytes |
| --- | ---: | ---: |
| Current station cache | 193,822,720 | 183,607,296 |
| Current price lookup | 87,744,512 | 63,692,800 |
| Expired query cache | 13,606,912 | 16,384 |
| Legacy price history | 8,331,264 | 2,416,640 |

## Preserved history

- Moved **72** caches expired over a day ago into one private gzip archive.
- Moved **6,909** legacy price rows older than 30 days into 14 private gzip archives.
- Kept **2,806** recent legacy rows in Postgres; oldest retained observation is
  September 28. App readers use a 14-day history window.
- Every archive was downloaded and checked for exact row contents and SHA-256
  before the source rows were locked, rechecked, and removed transactionally.
- `fuel-cold` contains **4,274,948 bytes**, across 15 objects. The existing
  `fuel-national` bucket contains **93,977,290 bytes** across 1,702 objects.
  Combined file storage is **98,252,238 bytes**.
- Archive object paths, hashes, cutoffs, sizes, and counts are recorded in
  [storage-audit.json](storage-audit.json) and the private `fuel_cold_archives`
  database manifest. No raw historical rows or user identifiers are committed.

Nationwide research history was already stored in compressed files and remains
there. Active city snapshots, failure evidence, discovery payloads, and reserved
holdout observations were not modified. There were no provider collection calls,
identity changes, raw price edits, ranking changes, or new collection schedules.

## Maintenance and validation

- Rebuilt both current price-lookup indexes concurrently and all current-station
  indexes concurrently. Live reads and writes remained available. All indexes
  were valid and ready after completion.
- Compacted only the small archived legacy tables with
  `VACUUM (FULL, ANALYZE, SKIP_LOCKED)`; did not exclusively lock or rewrite hot
  serving tables. Lowered their autovacuum thresholds to reuse dead pages sooner.
- Live cache retained **141,660 stations** and **321,248 price lookup rows**;
  a five-mile Tampa query returned 105 cached station records. This count is
  inventory, not a claim that every station has a fresh price for every grade.
- Latest nationwide run (04:00 UTC) completed all **72/72** batches, observing
  141,660 station IDs, with 95,141 having a reported price. Collection remained
  enabled and all three nationwide schedules remained active.
- Both status scripts succeeded. National status now includes database and total
  file-storage bytes for subsequent monitoring. Published Trends retained 10 scopes.
- **14 tests passed** across cold archive integrity/capacity, cached serving, and
  raw Trends history. Syntax checks passed for all changed scripts.
- The standalone exporter independently downloaded and verified all **15**
  manifested objects: 6,909 price rows and 72 cache rows, without database writes.
- Combined replay-input validation recovered all **9,715 original price rows**
  (6,909 archived plus 2,806 retained), producing 10,517 unique source events.
  The full historical model replay was stopped after roughly two minutes of CPU
  work; the input-only validation completed. No model or ranking change was made.
- The cold bucket is private, has no application Storage access policies, and
  both anonymous and authenticated app roles lack manifest read permission.
- An initial upload was rejected because the CLI identifies gzip as
  `application/x-gzip`. Added that explicit MIME type; the failed upload removed
  no database rows. Successful archives were then uploaded and read back normally.

See [operator instructions](../../../scripts/storage/README.md) for read-only
planning, guarded archival, and verified exports. Cold archival is an explicit
operator command; it does not add a background task. Legacy replay can combine
the exported history with the remaining database rows using `--archive-ndjson`.

## Phone installation

Release build of `ac9148a` succeeded with the existing signing team and was
installed over the existing app on the user's iPhone 18 Pro Max. Device inventory
confirmed `com.anthonyh.fuelup` is installed. This confirms installation, not a
physical driving test. The storage work is server/admin tooling and needs no
additional phone build.
