# Research outbox recent-read repair

The collector refreshes the latest 12 raw events after each recorded interaction and after upload state changes. The existing `(uploaded, recorded)` and `(kind, recorded)` indexes cannot supply the unfiltered `ORDER BY recorded DESC`. SQLite therefore scans and sorts the entire event table on each refresh, while the main actor waits for `queue.sync`.

The scoped repair adds `CREATE INDEX IF NOT EXISTS event_recorded_time ON events(recorded)` in the production store initializer, migrating both new and existing outboxes. It changes no records, predicates, order, upload semantics, retention policy, or WAL/FULL durability settings.

Validation on October 29, 2026 used the actual Swift store and system SQLite against a populated legacy database containing 100,000 synthetic records, shuffled unique timestamps, mixed kinds and upload states, and approximately 640-character synthetic payload strings. Each side received one warm read followed by nine measured reads; values below are medians. Baseline executes the original SQL with the same JSON decoding; the repaired path additionally goes through the production store's serial queue.

| Measurement | Legacy schema | Migrated schema |
| --- | ---: | ---: |
| Recent 12 read + decode | 22.348 ms | 0.0415 ms |
| Query plan | Table scan + temporary order B-tree | `event_recorded_time` index, no temporary sort |

This is a local macOS synthetic read benchmark, not a phone frame-rate measurement. No timing threshold is used as a test gate. The regression gates verify the query plan, recent/pending ordering, all 100,000 rows and their upload flags by a before/after SHA-256, counts, and idempotent reopening.

Commands that passed:

```sh
node --test tests/drivingResearchStoreIndex.test.cjs
node --test tests/drivingResearchCrossChecksNative.test.cjs
```

The full test output is retained in `store-read-test.txt` and `store-crosschecks-test.txt`.
