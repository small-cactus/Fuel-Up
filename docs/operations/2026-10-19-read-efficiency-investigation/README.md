# Collection read efficiency — October 19, 2026

Checkpoint: local validation complete; deployment and a full live read-optimized sweep are pending. The earlier write optimization is deployed and verified separately.

The normal 19:00 UTC sweep completed 72 batches and 141,660 fixed-inventory stations at 19:15:46; Trends published at 19:16:00 with no projection backlog. All five schedules, including retention, remain active. This provides the live read-cost baseline after write deduplication.

## Changes under test

- A private derived collection-state table stores metadata availability, E85 availability, exact price JSON SHA-256, base observation time, and batch membership. Unchanged ordinary price-only payloads avoid wide station reads. Changed, noncanonical, metadata-bearing, and unprepared rows retain the exact prior merge path.
- Transactional triggers synchronize state with station changes, including independent E85/metadata changes. An admin-only bounded preparation helper leaves prices and observation times unchanged. Freshness still advances once per verified batch.
- Batch Trends E85 checks use narrow state with a safe fallback.
- An exact archive manifest index reduces its working set. The independent Storage-object accounting and conservative invalid-size reserve remain intact.
- Nearby queries conservatively narrow longitude as well as latitude before the unchanged exact distance filter; date-line and pole crossings are covered.

## Evidence and limitations

The original live metadata check for 2,000 stations read 1,429 PostgreSQL blocks (11.16 MiB) and took 1.52 seconds. Full hourly baseline counter deltas are saved separately. These are PostgreSQL page reads, which can be satisfied by the OS cache; they are not measured physical disk reads.

All existing SQL safety/parity tests passed, plus compact-state fallback, synchronization, rollback, stale retry, numeric equivalence, archive accounting, permissions, and 30 exact geographic comparisons. A replay of 6,000 saved real stations preserved serving and Trends output. All 39 targeted Node tests passed.

A disposable 141,660-station database with 96 MiB shared buffers measured publication reads dropping from 17,407 to 241 blocks for an unchanged 2,000-station batch and from 17,536 to 463 blocks with 10% changed. The local contiguous metadata test did not show a latency improvement (1.82 ms versus 2.91 ms); the production fragmented-table cost must be measured again after deployment. Local PostgreSQL and warm OS cache results do not guarantee production savings.

Live geographic candidate comparisons returned identical results in all three regions, with roughly 21–50% fewer logical page visits. Sequential warming prevents attributing their elapsed-time difference entirely to the filter.

The pre-change host sample still showed swapping and 12.7% CPU I/O wait. No claim is made that memory pressure or total disk I/O is resolved. The fixed inventory and provider observations are not verified pump truth.
