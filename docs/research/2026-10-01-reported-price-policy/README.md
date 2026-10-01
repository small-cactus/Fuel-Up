# Reported prices, last 24 hours

The user requested removal of predicted prices and exclusion of stations without a price reported in the last 24 hours.

The cache-only serving function now filters every fuel grade/payment by the provider's `postedTime` before selecting credit/cash. It returns the uncorrected reported value, and does not read prediction history. Missing/invalid/future timestamps and non-positive prices are excluded. Age is inclusive at exactly 24 hours; exclusion starts one millisecond later. A recently collected old report does not become fresh. Archived raw data and research models are retained.

The client applies the same eligibility rule to responses, exact/spatial local caches and Home cards. A new cache namespace invalidates prior estimated snapshots. A timer removes an expiring visible station without a network request, and the cheapest remaining eligible station is reselected. The estimate badge is removed from the current Home card. Radius and fuel/E85 filtering remain in effect.

Validation:
- 143 application tests and 54 cloud tests pass. Updated cache tests exercise the actual cache-only serving implementation rather than the retired provider-fetch/prediction path.
- 16 focused policy/cache/trajectory checks pass, including exact cutoff, independently aged grades/payments, old corrections, raw-value persistence, cache reset, and idle expiry.
- 24 live radius checks across six cities pass. Empty results are valid: the central New York 2-mile query had two stored stations but no eligible recent regular reports.
- Seven 15-mile city comparisons read the protected DB, independently select fresh raw regular quotes, and verify exact served IDs, prices and report timestamps. See `raw-price-comparison.json`.
- Simulator Home reloaded with 122 Tampa stations at the retained 10-mile setting, Costco $3.92 first, reported one hour ago, without an estimate badge. Screenshot retained. No phone installation performed.

The first two post-deployment serving checks returned CACHE_UNAVAILABLE even though direct protected DB access worked; subsequent deployment/read checks recovered. Evidence is retained in `initial-live-failure.txt`; underlying transient cause is unconfirmed. Server logs now retain the backend error code/message for future diagnosis.

No native cluster animation code changed. This task does not claim to fix the previously documented retired-renderer live probe failure.
