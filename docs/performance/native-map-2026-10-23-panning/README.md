# Native map panning — October 23, 2026

The user reported less than 20 FPS while panning without zoom. Profiling found avoidable native overlay work: every camera frame reapplied the settled price/count glass layout. The React trace recorded only two commits over 28.35 seconds. Native stack samples repeatedly included renderer, reconciliation and glass layout work. This identifies unnecessary work, but does not prove the complete cause of the phone's frame rate.

The renderer now keeps an immutable settled layout and lets the existing MapKit annotation carry it through uniform translation. Every frame still reconciles current projected stations, culling and ownership. Reuse requires unchanged camera scale/heading/pitch, selection, theme, safe bounds, contact offsets, membership and location clearance. Every projected station and the user dot must match the original snapshot translation within 0.00001 points. Zoom, transitions and changed inputs use the full renderer. Before a split/merge or full render, accumulated translation is materialized into the prior visual geometry so handoffs start in the correct coordinate space. The clearance cache records the solver's raw target separately from its displayed deadband-limited offset.

## Matched measurements

Same Debug binary on FuelUpStoreiPhone, iOS 26.5 simulator. Identical frozen 53-station fixture; six alternating 1.5-second horizontal swipes from `.argent/flows/native-map-pan-only.yaml`. The control disables only layout reuse using a DEBUG environment flag. Compilation and sampling profilers did not overlap these timed runs.

| Per-camera-frame overlay CPU | Control 1 | Control 2 | Optimized 1 | Optimized 2 |
| --- | ---: | ---: | ---: | ---: |
| Mean, ms | 2.231 | 2.254 | 1.120 | 1.157 |
| P95, ms | 2.580 | 2.642 | 1.347 | 1.345 |
| Reused frames / camera frames | 0/595 | 0/597 | 597/597 | 596/596 |

The average of the two run means fell from **2.242 ms to 1.138 ms: 49.24% less overlay CPU**. Full data and per-run distributions are in `comparison.json`; compressed reports retain individual samples.

Independent fresh geographic projection comparison stayed within 3e-13 points in both optimized pan runs. Pre-commit UIKit hierarchy error peaked at 6.28 points, compared with 6.28–12.00 points in controls; these readings include the MapKit annotation's callback-stage timing and are not post-render pixel measurements. The mixed pan/zoom flow also passed, with geographic layout error below 4e-13 points. Swiping the station card afterward selected Texaco and focused the map on it; `after-card-swipe.png` records that separate visual check.

**Limits:** the simulator did not reproduce the phone's reported sub-20 FPS. Its model callbacks remained approximately 60 Hz in every run. Callback cadence is not presented GPU FPS. These results establish less application CPU work during pan, not a measured phone frame-rate improvement or reduced total GPU cost. Native glass and MapKit rendering remain potential device-specific costs.

## Verification and reproducibility

`standard-tests.log`: 165 standard tests passed. `swift-tests.log`: seven existing native unit runners passed. `pan-unit-tests.log`: production snapshot logic passes translation reversal, no accumulated drift, camera deformation, culling/ownership, theme/selection, dot, clearance, scale and deadband regressions. Camera stubs are unit inputs; they do not replace the live map checks.

For the manual live measurement, launch Debug with `FUELUP_MAP_PERFORMANCE_PROBE=<unique-token>` and `FUELUP_MAP_PAN_PROBE=1`. Wait for the matching `Documents/map-pan-ready.json`, execute the recorded flow, then read `Documents/map-performance-probe.json` after the 40-second capture completes. Set `FUELUP_MAP_DISABLE_PAN_REUSE=1` only for controls. All probe flags, fixture loading and exports are excluded from Release. The original automatic performance probe and strict cluster-animation assertions are unchanged.

All 26 native integration/routing checks passed (`native-tests.log`), including long-pan carrier attachment, focus/show-all, camera persistence and E85 transitions. Retained legacy gate results are recorded in the accompanying test log and release report. The legacy probe records the non-shipping JS renderer; it does not exercise the native fast path. Its thresholds must not be weakened to accommodate existing failures.

The retained legacy gate failed in this run: visible p95 4.029px, p99 21.086px, maximum 47.616px, and outside-layer coverage 2 (required 100). Builds 36/37 already documented timing failures in that non-shipping JS renderer; this run also failed its outside-layer coverage assertion. No legacy renderer or assertion was changed. This is a failed check, not a pass or a phone-performance result. `legacy-probe.json.gz` preserves the artifact.
