# Avoid hidden glass allocation during map startup

Baseline: `88f3287` (build 36). The user asked to reduce first map-load work when native glass and map caches are cold.

## Finding and change

Native station data can arrive before the carousel reports its height. `fitIfNeeded` correctly waited for that height, but `tick` still reconciled and rendered invisible station pills at a provisional camera. A later initial fit discarded those motions and built the actual overview. Which camera/data callback arrived first made this waste intermittent.

Before the first station presentation, reconciliation and rendering now wait for content readiness, a successful camera fit, and a settled camera. MapKit continues loading. Readiness reporting remains active for empty results; delegates and prop/layout updates wake rendering. The older display-link fallback uses the same gate. After first presentation, camera updates and existing split/merge behavior use the original path.

The renderer also starts in compact-initial-layout mode, covering an animated first fit or early card selection. Initial clusters need only owner prices and count badges; they do not need a temporary price surface for every hidden member. No stations are removed, clustering distances are unchanged, and no custom substitute for Apple's glass is introduced.

## Process-cold measurements

Debug build, iPhone 17 Pro simulator, iOS 26.5, Xcode 27.1. Three launches before and three after, same existing simulator, 62-station result, 393pt card inset and final camera distance 91,821.62. Every launch terminates the process first; these runs retain MapKit disk caches. No builds, lint, tests or sampling overlapped the included timing runs. `before-sample` is separate diagnostic sampling, excluded from comparisons. Station data came from the app's existing cache/service, not a frozen-price replay.

| Run | Glass surfaces before fit | Surfaces at first visible prices | Parent containers at first visible prices | Pre-fit overlay CPU | Total captured overlay CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before 1 | 1 | 20 | 4 | 2.09 ms | 48.95 ms |
| Before 2 | 40 | 55 | 5 | 53.74 ms | 81.96 ms |
| Before 3 | 1 | 20 | 4 | 1.63 ms | 33.86 ms |
| After 1 | 1 | 20 | 4 | 0 ms | 35.68 ms |
| After 2 | 1 | 20 | 4 | 0 ms | 32.15 ms |
| After 3 | 1 | 20 | 4 | 0 ms | 36.06 ms |

The surface counter includes **one carousel control**. Thus the expensive baseline made 39 provisional map pills and eventually allocated 54 map pills, compared with 19 map pills after the fix. That is 35 fewer allocations (64.8%) in the affected path, not a 64.8% reduction on every launch: the two favorable-order baseline runs already used 19 map pills. All three optimized launches avoided provisional renderer work. The final probe additionally records map-only allocations directly so the regression does not depend on the carousel count.

The largest overlay call in included runs was 20.64–36.94 ms before and 21.49–23.63 ms after. This change removes avoidable work; it does not eliminate all initial rendering cost. Values measure app-side reconciliation/render CPU, not GPU/compositor time, physical-phone FPS, total app launch time, or map download duration. Do not extrapolate a guaranteed launch-time percentage from three runs.

## Fresh simulator / map cache check

Two disposable simulators were created from scratch with the same device type/runtime. Only the same app preferences, saved test location and station-cache snapshot were copied; no MapKit, HTTP, Metal, research database or installation identity was copied. Location permission was pre-granted and the same simulated coordinate set. These are fresh simulator sandboxes, not a measured reboot of a physical iPhone.

The initial exploratory `fresh-before/after` setup accidentally set Cupertino while the saved app location was Tampa. That changed both location and data (22→90 stations before, 21→89 after). These artifacts are retained for audit, but their durations and allocation totals are **not** evidence of an equivalent cold-start improvement.

Both disposable simulators were erased and configured again with the same saved snapshot and the correct Tampa location (27.9506, -82.4572). The corrected `fresh-tampa-before/after` runs both displayed 61 stations, the same 393pt inset and 91,821.62 camera distance:

| Corrected fresh sandbox | Before | After |
| --- | ---: | ---: |
| Glass surfaces before initial fit (includes carousel) | 40 | 1 |
| Glass surfaces at first visible prices / ready | 55 | 20 |
| Parent glass containers at first visible prices / ready | 5 | 4 |
| Provisional renderer calls | 7 | 0 |
| Final map-only pills (direct counter added in final diagnostics) | Not separately instrumented | 19 |

That is **35 fewer total glass-surface allocations (63.6%)** in this affected fresh-sandbox path, with the same station count and framing. The after run directly confirms zero map-only pills before fit. Both became ready, and allocations remained stable through the end of the report. Native view-to-first-visible time was 1.226 versus 1.234 seconds; readiness was 2.212 versus 1.970 seconds. **Do not use these durations for a performance percentage**: release compilation overlapped these allocation/correctness checks, map/network caches below the simulator boundary are uncontrolled, and they are one run each. The isolated process-cold timing runs above are separate.

The earlier location-switch experiment also shows that a large network result replacing a smaller visible result can create a separate burst after first presentation. The gate deliberately preserves those existing transitions. Optimizing genuinely new arrivals safely needs separate count, owner-promotion, refresh and subsequent-split tests; missing motions alone are not proof a station was never visible.

## Verification

The launch integration test now checks actual native map-pill and parent allocations before first fit and rejects provisional renderer work before first visible stations. Existing readiness, measured card inset, no visible nonanimated refit, and animation assertions remain intact.

Standard suite: 165/165. Native geometry/dynamics/grouping/focus/market/clearance unit runners: 7/7. App/src lint: zero errors, 672 pre-existing warnings. Whole-repository lint additionally encounters three pre-existing JSX parser errors outside that configured scope (two devtools files and the glass module entry); no JS application code changed.

All 26 native integration/routing checks passed across the full run and one targeted rerun. The initial full run had 25 passes and one missing probe export immediately after installation; rerunning that exact first probe after the app was open passed. No probe assertions or time limits were relaxed. The retained legacy debug-map gate still fails its existing limits (visible p95 3.811px, p99 27.088px, max 52.210px); this is the same non-shipping legacy renderer limitation recorded in build 36.

The existing `native-map-cold-pan-zoom` Argent flow passed all four gestures and its station-card assertion from the Tampa Home overview after relaunch. Screenshot included; this was visual/behavioral QA during release compilation, not an FPS benchmark. No physical iPhone was launched or measured.

Implementation checkpoint: `97d8396`, pushed to `master`. Release verification is recorded separately under `docs/releases/build-37`.
