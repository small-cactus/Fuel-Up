# Nationwide hourly price collection

Enabled for the first full hour at **2026-09-30 22:00 UTC**. A complete price run and archive read-back are still pending. This initial research window ends **2026-10-07 18:19 UTC**; it is not an indefinite feed or automatic inventory-refresh service.

## Catalog and regional ownership

The installed catalog has **141,660 unique station IDs**, spanning all 50 states plus DC, with **72 fixed-ID price requests per hour**. Metadata discovery is separate from hourly price refreshes.

| Worker | Actual execution region | Station IDs | Batches/hour |
| --- | --- | ---: | ---: |
| East | us-east-1, Virginia | 117,700 | 59 |
| Southwest | us-west-1, Northern California | 17,747 | 9 |
| Northwest | us-west-2, Oregon | 6,213 | 4 |

The main database remains in US East (Ohio), project `vjindchxfebaltbslqwc`. Every worker rejects a mismatching `SB_REGION` before accessing the queue or provider. There is no cross-region failover. The retired single-worker endpoint cannot collect.

Forty-nine states reconcile to complete provider state inventories. Texas has a complete 646-query geographic sweep: all responses complete, zero uncovered area across the Census boundary under the documented radius assumption, and every state/brand/fuel-scoped ID included. It returns **15,272 IDs**, whereas the provider's statewide aggregate says **15,271**. Both numbers are preserved; the cause of the discrepancy is unconfirmed. DC uses two complete overlapping circles enclosing its boundary and agreeing on 110 DC-addressed IDs. These two geographic certificates assume the empirically observed approximately 25 km nearby footprint; they are not provider-issued completeness guarantees.

See [inventory-verification.json](inventory-verification.json), `verified-catalog.json.gz`, and [DISCOVERY.md](DISCOVERY.md). Inventory timestamps remain truthful: this run refreshes prices for a fixed, dated cohort through the bounded window. It does not claim daily discovery of new stations or verified current pump prices.

## Rate policy and scheduling

The original local probe logged 15 successful requests in 34.56 seconds, then HTTP 429 on the next request. An earlier 15-request burst also succeeded. This suggests a burst allowance near 15 requests, possibly per minute, but **the exact quota, window, key, and weighting are unverified**. See [rate-limit-burst-evidence.json](rate-limit-burst-evidence.json). The public limiter wrapper takes external configuration and does not disclose endpoint production settings.

The national schedule initially allows approximately **five batches per minute**, with a shared 10-second minimum between starts and only one active request across all regions. Every minute, Cron resumes a region-pinned worker for up to 45 seconds. Estimated first-pass duration is 15–20 minutes, pending measurement. HTTP batching still performs 141,660 station resolutions; it does not turn that into only 72 units of backend work.

- Honor positive `Retry-After` in seconds or HTTP-date form without imposing an hour-long minimum.
- Without that header, successive 429s since the last success use 60, 120, 240, 480, 960, 1920, then 3600 seconds.
- Retry eligibility is followed by the next scheduler tick; it is not an exact-second resume guarantee.
- Share cooldown across all regional collectors and the existing city research campaign. Preserve the error evidence. Do not change region, IP, session, or account to continue through a denial.
- Stop on 401/403 or ambiguous GraphQL failures for inspection.
- Allow 161,660 station lookups and 92 HTTP attempts per hour, including retry headroom. These are operator budgets, not a provider-issued quota.

The five-minute watchdog only repairs a missing main schedule while enabled and inside the research window. It does not override pauses or provider blocks. Expired jobs remain visibly missed; no backdated collection is fabricated.

## Raw archive and verification

Each batch preserves all returned fuel grades, cash/credit quotes, original posted timestamps, missing prices, observation timestamps, and actual execution region. Gzip objects use immutable lease-specific paths in private Storage. The database records IDs, hashes, byte counts, and completion metadata. A fenced commit prevents expired workers from publishing over newer attempts.

Archive accounting includes uploaded objects even if their completion transaction failed. The initial cap is 900 MB; reaching it pauses acquisition without deleting research evidence. Florida measurements project roughly 4.1 MB per national hour, subject to replacement by actual nationwide measurements. No paid plan or automatic history deletion was enabled.

```sh
node scripts/national-prices/status.mjs
node scripts/national-prices/auditHour.mjs RUN_ID /new/report.json
```

The audit downloads the actual immutable objects and verifies bytes, SHA-256, exact station IDs, absence of cross-batch duplicates, observation windows, regional provenance, and priced/unpriced counts. It makes no provider requests. Administration is pinned to Supabase CLI 2.118.0.

Verification so far: 58 focused Node tests, two Python geographic-certification tests, transactional PostgreSQL queue/window/watchdog checks, real regional discovery, and live correct/wrong-region routing checks. **A full nationwide price hour, sustained throughput, and archive read-back remain pending.** App UI, production ranking, and raw-price correction are unchanged.

Earlier evidence and the initial paused design are retained in [BOOTSTRAP_CHECKPOINT.md](BOOTSTRAP_CHECKPOINT.md) and [REGIONS.md](REGIONS.md); their historical status statements are superseded by this file.
