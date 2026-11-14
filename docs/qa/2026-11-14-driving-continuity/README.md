# Driving continuity — November 14, 2026

## Reproduction and acceptance

Used the iOS 26.5 simulator `Fuel Up Alerts Review`, with Apple's built-in CoreLocation interpolation (`simctl location start --speed=13.4 --interval=1`) through these San Francisco waypoints:

```
37.7749,-122.4194 37.7730,-122.4170 37.7700,-122.4130
37.7660,-122.4080 37.7620,-122.4030
```

Each comparison resets to the first point, replays `.argent/flows/driving-state-20261114.yaml`, selects the second station (18894, Marathon), and starts the same route. The speed is approximately 30 mph. Prices are existing app observations, not independently verified pump prices. No physical phone was opened.

Acceptance: ordinary GPS updates must not transiently publish an empty station list, unmount the carousel/retained cards, discard the selected station, or force-scroll an active swipe. Real changes to prices, displayed distance/age, search criteria, radius eligibility, and quote expiry must still update the UI.

## Findings and iterations

1. The original exact-coordinate result scope returned an empty list before each asynchronous cache lookup. This removed the native chips and carousel and cleared selection. Preserve compatible raw snapshots across GPS movement, rebase distances and apply filtering synchronously, cancel obsolete publications, and expire quotes independently of network completion. Explicit search changes remain separate sessions.
2. Raw station object identity and inline layout callbacks redrew native SwiftUI cards on unchanged content. A primitive presentation snapshot now controls memoization; navigation still resolves the latest raw station. Selection synchronization runs only when the selected index changes and respects an active swipe.
3. The shared GPS context also invalidated the navigator and Settings. Separate stable actions and probe/reveal controls from moving-location subscriptions, preserving the combined API and all effects.
4. Trends still needs location updates for its data controller, but unchanged chart and leaderboard leaves now use ordinary shallow memoization. No screen freezing or background lifecycle changes.

## Runtime continuity evidence

`commit-probe.js` observes real React commits/unmounts and forwards the original DevTools hooks. These are committed-state samples, not individual display frames. The baseline screenshot independently shows a visible empty map/card handoff.

| Version | Probe duration | Commit samples | Empty station lists | Carousel/card unmounts | Selection |
| --- | ---: | ---: | ---: | --- | --- |
| Original | 59.7 s | 78 | 31 | 6 carousel, 13 cards | 18894 reset to 14373 |
| Snapshot continuity | 62.4 s | 65 | 0 | 0 | 18894 retained |
| Card/scroll changes | 226.2 s | 174 | 0 | 0 | 18894 retained |
| Context isolation | 49.1 s | 47 | 0 | 0 | 18894 retained |
| Final, with Trends leaf isolation | 76.7 s | 37 | 0 | 0 | 18894 retained |

Profiles are development builds with profiling overhead. Session lengths differ; raw totals are not a controlled frame-rate or production speed comparison. The reports show the navigator/Settings cascade disappearing after context isolation and unchanged native cards avoiding render work. No universal smoothness or hardware performance claim is made.

## Native profiling

Argent's initial native recorder attached to host-wide processes and could not export valid CPU/hang tables. Its empty combined-report hang count is not usable evidence. The successful fallback explicitly targets this simulator and its app PID with `xcrun xctrace record --template 'Time Profiler' --device <simulator> --attach <PID> --time-limit 30s`.

The card-change trace recorded one 280.06 ms microhang. Its sampled main-thread stack includes Swift protocol conformance/ObservableObjectTable work; most main-thread samples elsewhere were MapKit rendering. This is attribution evidence, not proof of a single cause. The subsequent context-isolation trace exported the Hangs table successfully with zero rows at the configured >250 ms threshold. A short trace cannot prove the absence of all stutters.

Large raw Instruments/CPU traces remain in `/tmp/fuelup-driving-*.trace` and Argent's profiler temporary directory. Compact reports and continuity data are preserved here.

## Known legacy gate failure

The retained legacy React Native map probe failed its unchanged strict gate: p99 6.790 px, maximum 82.907 px versus the 2 px limit, and outside-layer coverage 33 versus 100. It completed with 1,623 samples, 155 transitions, no timed-out stages, and preserved reset geometry. The first attempt was obstructed by queued iOS deep-link confirmations; its zero-sample failure is also retained.

This is an unresolved failure, not a passing full suite. Build 33 already recorded the same failure families (see `../../releases/build-33/README.md`). The legacy renderer/probe/assertions are unchanged; the iOS Release route excludes that screen. Different live scenarios prevent treating the lower current number as an improvement. No threshold, coverage requirement, failure handling, or exported measurement was weakened. Shipping native-map checks are recorded separately.

## Test fixture correction

One existing cache test intermittently created its reported price inside an awaited database read, after the server captured its validation clock. A 1 ms future timestamp was correctly rejected. The fixture now uses a report timestamp one minute in the past; production validation and all assertions are unchanged.

## Environment limitation

The unsigned Debug simulator reports an existing Expo Notifications keychain-entitlement error. This does not establish a signed Release notification failure. Release signatures and entitlements must be validated separately.

## Final checks

- 188 unit tests, 47 Trends tests, and 10 release/lifecycle checks passed. Full source/app lint has zero errors; comparable source warnings decreased from 602 to 600 (672 warnings including app files).
- Native suite: 25/26 passed initially. The failed horizontal-only fit assertion was proved geometrically incorrect for a vertically constrained viewport; all-edge tightness retains the same 1 pt tolerance and every clipping assertion. The corrected isolated live test passed across 120 frames. See `initial-fit-correctness.md`. No native renderer change was needed.
- The final 76.8-second React capture contains 2,370 component renders and 36 commits, versus 8,044 renders and 77 commits over 80.3 seconds in the baseline. These similar-duration development recordings support reduced work, not an exact production FPS claim. Legitimate displayed price/distance/age updates still render.
- The final 30-second native trace also exported zero >250 ms hang rows. Home, Trends, and Settings were opened and visually checked after the drive. Screenshots preserve the selected station, loaded chart/leaderboard, and Settings.
- The polished flow uses the stable native carousel ID. A later replay under concurrent compilation failed its post-swipe check, with development warning overlays present. Adding the missing native-idle readiness wait restored a complete 6/6 flow replay even during compilation. The failed replay is retained as a harness/environment limitation; successful driving profiles were captured before compilation.
