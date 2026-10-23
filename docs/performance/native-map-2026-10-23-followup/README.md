# Map frame-work follow-up to build 35

The user confirmed build 35 improved gestures and requested another optimization. Baseline is `6194ee5`. This pass preserves native MapKit, glass materials, camera behavior, grouping thresholds, and animation trajectories.

## Discovery and changes

A six-second native process sample during the existing 53-station camera workload identified repeated UIKit label property assignments in `ClusterLabPill.render`, alongside native reparenting and grouping. Moving pills re-applied dynamic text colors, bounds, frames and alpha every frame. Unchanged properties now stay in place; camera motion updates center, and actual width/scale/role changes still update layout and fades. Dynamic UIColor.label is retained, so UIKit owns trait resolution. Accessibility still reflects updated content and market descriptions.

The renderer also repeatedly projected identical map points shared by settled cluster members. Exact x/y projection results now live only within one synchronous render call. There is no cache across frames, no rounded coordinates, no replacement projection math, and no throttling. This avoids 85.82% of render-path conversions in the measured workload (169,503 requests, 24,034 actual conversions). Reconciliation conversions are outside this count.

## Matched measurements

Debug simulator, Xcode 27.1 (27A9275), iOS 26.5 runtime, same simulator and saved 53-station/camera fixture. Two runs before and two after; three four-movement cycles per run. Each run restarts the app; MapKit disk tiles are not cleared. No builds or profiling capture overlapped the included timings. Each table value is the mean of the corresponding cycle metric, not a pooled percentile.

| Overlay CPU metric | Build 35 baseline | This change | Reduction |
| --- | ---: | ---: | ---: |
| First cycle median | 2.34 ms | 2.09 ms | 10.3% |
| First cycle p95 | 8.08 ms | 7.45 ms | 7.8% |
| Repeat cycle median | 2.60 ms | 2.05 ms | 21.2% |
| Repeat cycle p95 | 7.78 ms | 7.26 ms | 6.7% |
| First cycle maximum | 17.72 ms | 17.34 ms | 2.2% |
| Repeat cycle maximum | 17.60 ms | 17.36 ms | 1.4% |

Peak cost is effectively unchanged; this does not prove all initial hitches are gone. Native reparenting/compositing still costs time. This is overlay reconciliation/render CPU in a Debug simulator, not physical-phone FPS, total frame time, GPU time or network performance. Native allocation counts are essentially unchanged, as expected for this second pass. Benefits in sparse/all-moving scenes and on device remain unmeasured.

`before-2/3` and `after-2/4` are included matched runs. `after-1` is the intermediate property-write-only change, whose mean cycle p95 improved about 3.8%; it motivated measuring the exact-point cache separately. Exploratory `before-1` overlapped native sampling, and `after-3` overlapped brief test/lint work, so neither is used for the comparison. Raw exploration and sample remain under `/tmp/fuelup-map-second-pass/`.

## Validation

Real UIKit presentation checks pass for camera-only movement, width-only and scale-only changes, fades, count/price transitions, same-geometry station adoption, E85/accessibility content, recommendation changes and dynamic foreground resolution. Actual reuse/ownership checks also pass in both measured runs. Standard suite: 165/165 on final rerun; seven native unit runners pass. The first standard run had an unrelated local-cache assertion failure; the isolated file and complete rerun passed without source/test edits. App/src lint remains zero errors and 672 existing warnings.

All 26 live native integration/routing checks pass, including camera persistence, launch, tint identity, E85, and repeated split/merge/focus interactions. The retained legacy debug-renderer gate still fails (visible p95 4.003 px, p99 20.931 px, maximum 53.125 px; see legacy-gate.log). This renderer is excluded from shipping Release; its test and thresholds were not changed. Release archive/export and strict distribution-signature checks passed for the app and both extensions at build 36. Debugging is disabled, APNs is production, and native benchmark code is excluded from the release executable.

The existing native-map-cold-pan-zoom Argent flow passed all four gestures and the station-card assertion. A one-off UI check switched Light → Dark → Light and inspected the native map each time; foreground labels, prices and counts remained legible (screenshots included). The attempted theme-flow recording lacked native-devtools injection, so its incomplete recording was discarded; this is manual simulator evidence, not a replayable theme-test pass. Both app and simulator appearance were restored to Light.
