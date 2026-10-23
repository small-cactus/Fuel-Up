# Native map gesture allocation work

The reported symptom was slow initial pan/zoom that improves after several movements. The measured app-side issue was repeated native glass allocation during cluster splits, merges, and viewport culling. React was quiet during gestures. This does not establish whether MapKit tile loading or first-use GPU/material compilation also contributes on the user's phone.

## Changes

- Reuse up to six empty, detached native glass containers within their existing tint/group namespace.
- Reuse up to 64 detached station pills by unchanged station identity/content. Clear the cache on station snapshot changes and memory pressure; reject stale late retirements. Refresh geometry, selection, focus actions and market presentation before display.
- Keep exact connection diagnostics for recording/probes, but avoid their second clustering pass during ordinary gestures. Sort paint IDs once per update.
- Use the existing station ID lookup for owner coordinates.
- Keep MapKit, native glass, animation trajectories, tint rules, camera persistence and station-card navigation.

## Matched measurements

Debug iOS simulator, real MKMapView and UIKit effects, 53 stations, identical frozen station/camera fixture (SHA in `summary.json`). Two original-renderer runs and two optimized runs. Each run has three cycles of zoom in, zoom out, pan and return. No builds ran during measurement. The original renderer and glass grouping were rebuilt from `90a2279`; only DEBUG timing/workload instrumentation was added to the baseline. The final optimized source was restored and rebuilt afterward.

Each cell is the mean across the relevant cycles/runs; p95 is the mean of each cycle's p95, not a pooled percentile.

| Metric per four-movement cycle | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| First cycle: new glass containers | 16 | 3 | 81% |
| First cycle: new station pills | 89.5 | 46.5 | 48% |
| First cycle: overlay CPU p95 | 8.54 ms | 7.69 ms | 10% |
| Repeat cycles: new glass containers | 14.5 | 0.25 | 98% |
| Repeat cycles: new station pills | 91.25 | 20.25 | 78% |
| Repeat cycles: overlay CPU p95 | 8.52 ms | 7.49 ms | 12% |

The first-cycle pill count varied from 36 to 57 after optimization versus 88 to 91 before. Startup work before the timed cycle can vary. First-cycle maximum CPU time was effectively unchanged; this is not proof that every initial hitch is gone. Across all cycles, mean p95 improved 11%, and mean cycle maximum improved 14%.

`*.json.gz` retain native timing samples, allocation counters, camera phases and the identical fixture. Measurements cover the app's overlay reconciliation/render CPU only, not total frame time, GPU work, network tiles or physical-phone FPS. UIUpdateLink model-time intervals are not presented as a display frame-rate result. MapKit's on-disk tile cache was not cleared.

Initial exploration used live station snapshots (54 then 53 stations); those numbers motivated changes but are excluded from this matched comparison. Container pooling alone reduced creation but did not materially improve CPU time. Reusing pills and removing diagnostic work provided the measured improvement.

An initial React trace captured 218 fiber renders, four commits and no commits over 16 ms across about 40 seconds. Native Instruments trace export failed with a missing-template/document error; no native CPU/hang conclusions were taken from that trace. The opt-in native timing probe above supplied the usable measurements.

## Reproduce

Start Metro, install a DEBUG simulator build, and run:

```sh
FUELUP_SIMULATOR_UDID=<explicit-simulator-UDID> node scripts/mapPerformanceProbe.cjs /tmp/map-performance.json
```

The first run stores `Documents/map-performance-fixture.json` in the simulator app container. Later runs use that same input; remove that one generated file only when intentionally recapturing a baseline. The probe is DEBUG-only and requires its explicit launch environment token. It restores normal station ownership after measurement. The raw gesture flow `.argent/flows/native-map-cold-pan-zoom.yaml` separately exercises touch input.

Cache checks inspect actual UIKit object reuse, capacity, detach state, selection reset, stale-content rejection, removal/re-addition and active/idle ownership. The existing live native suite remains the regression gate for transitions, tint changes, focus, camera persistence, launch, E85 and map geometry; none of its assertions were weakened.

## Validation results

- All 26 native integration/routing checks passed, including 50-cycle tint/recommendation tests, camera persistence and cold launch.
- All 165 standard tests and seven native geometry/grouping/market/focus unit runners passed.
- App/src performance lint: zero errors, 672 pre-existing warnings, unchanged from baseline. A broader `eslint .` also encounters three pre-existing JSX parser-configuration failures outside app/src; no unrelated lint changes were made.
- Both optimized matched measurements passed actual native cache reuse/invalidation and live active/idle ownership checks.
- The retained legacy React Native cluster gate still fails (maxFrameDelta 528.425 px versus its unchanged 2 px limit), as it did before this task. That renderer is excluded from shipping iOS Release. No legacy assertions or exports were changed; this is not an all-renderers-passing claim.
- Recorded touch pinch/pan flow passed twice after a fresh app restart; Home and station navigation remained present, with no visible error screen. See `after-touch-gestures.png`. The debugger runtime responded as DEBUG/Hermes; its newly attached log registry was empty, not a historical no-error claim.
