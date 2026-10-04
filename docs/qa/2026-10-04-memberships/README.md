# Membership loading and native Skip/Save — 2026-10-04

## Implementation

- The RPC uses a partial state index containing only membership-chain candidates, while retaining the exact brand matching and state validation rules.
- Shared in-flight requests prevent duplicate reverse geocoding and RPCs. Successful state resolution is cached for five minutes and membership IDs for 30 minutes, with 128-entry LRU bounds. Failures remain retryable; changing coordinates cannot publish stale results. Exact coordinates avoid rounding across state borders.
- The native footer uses Apple's `GlassEffectContainer`, stable `glassEffectID`s and matched-geometry glass transition. Continue becomes Skip and Save splits beside it. Reduce Motion removes the explicit animation. Older iOS uses simple capsules.
- Skip restores the membership/favorite values present before onboarding, while retaining current fuel/location choices. Save applies all choices.

## Live backend verification

Applied the partial index separately with `CREATE INDEX CONCURRENTLY`, then replaced the RPC through the authenticated Supabase SQL editor. Existing grants were preserved. The checked-in migration uses transactional-compatible `CREATE INDEX IF NOT EXISTS`, which is a no-op for that deployed index. It was not submitted through a broad migration push.

The index is valid. A read-only comparison against the original full-inventory matching rules returned **51 states checked, zero mismatches**. Florida candidate lookup used `Index Scan using fuel_station_latest_membership_state`, examined 119 rows, and took **0.539 ms execution time** (0.546 ms planning, 121 shared buffer hits).

Sequential public RPC requests from this Mac (network included):

| State | Before, first / repeat | After, first / repeat |
| --- | --- | --- |
| FL | timeout 3924 ms / 932 ms | 529 ms / 172 ms |
| CA | timeout 3333 ms / 970 ms | 420 ms / 82 ms |
| NY | 2099 ms / 233 ms | 216 ms / 90 ms |

All nine post-change requests succeeded, including VT, normalized ` fl ` and invalid `XX`. Successful outputs matched the baseline. These are a small sequential sample with cache and network effects, not a load test or latency guarantee. Raw measurements are in `before.json` and `after.json`.

## App verification

- 41 focused tests passed: membership request concurrency/cache/expiry/error recovery/state changes plus existing onboarding flow, continuity, assets, location, native bridge and membership filtering tests. Scoped ESLint and `git diff --check` passed.
- Debug simulator build and signed Release phone build succeeded; Release incremental build took 87 seconds. Signature verified with `codesign --verify --deep --strict`.
- iPhone 17 Pro Max simulator, iOS 26.5: progressed through onboarding using the live API. Memberships were populated on entering the page. Recorded and inspected the native split (`split.jpg`; original video retained locally under `.argent/recordings/screen-recording-E5661CAA-BB65-4806-879A-D00C553836E7-1791149333610.mp4`). Both light and dark appearances were inspected.
- Selected Premium, Costco and 7-Eleven, then tapped Skip. App preferences contained premium fuel, six-mile radius, empty memberships/favorites, and completed onboarding.
- Reopened onboarding, selected Costco and 7-Eleven, and tapped Save. App preferences contained `fuelMemberships: ["costco"]`, `preferredBrands: ["7-eleven"]`, premium fuel, six-mile radius, and completed onboarding.
- Installed the freshly signed Release app in place on the connected iPhone 18 Pro Max using `devicectl`; app listing confirmed `com.anthonyh.fuelup`. Phone data was preserved. Phone launch/visual interaction was not performed; visual QA above was on the simulator.

Native API reference: [Apple — Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views).
