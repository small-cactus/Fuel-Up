# E85 visibility audit — October 1, 2026 18:49 UTC

Read-only database audit; no provider requests or serving changes.

Current serving treats a recent, positive E85 price as evidence of E85 availability. `freshReportedStation` removes stale grade/payment quotes before normalization; `getCachedGasPrices` then requires a positive remaining E85 price when `requiresE85` is enabled. The app also checks availability from the normalized quote. Thus “requires E85” filters on fresh E85 pricing, even when the selected purchase grade is regular or premium.

The scheduled metadata query requests name, location, address and ratings, but no separate fuel availability field. Missing E85 quotes therefore cannot distinguish a station that does not sell E85 from one that sells it without a reported price.

| Scope | Cached stations | Positive E85 price with timestamp | E85 price within 24h | Excluded by age |
|---|---:|---:|---:|---:|
| US | 141,660 | 3,633 | 3,009 | 624 |
| FL | 7,928 | 139 | 123 | 16 |
| Clearwater-area bounding box | 270 | 3 | 3 | 0 |

Local scope is an explicit bounding box (27.8–28.2 N, -82.85–-82.6 E), not the user's exact radius or a city boundary; it includes nearby communities and northern St Petersburg. It contains 8 RaceTracs, 3 with E85 quotes; 17 Wawas, none with a positive E85 quote (one has an empty E85 entry). These counts do not prove how many actually sell E85.

For regular + E85 availability, 3,222 US stations have fresh regular plus any timestamped E85 price; the current fresh-E85 condition leaves 2,937. Availability should be modeled separately from price freshness. Keep the selected purchase grade's 24-hour/raw-price rule; do not infer missing prices or assume an entire brand sells E85.

`coverage.sql` and `local.sql` reproduce the queries; their JSON outputs preserve this observation. Counts are latest-cache observations rather than verified pump availability or prices. No eligibility changes were made in this audit.
