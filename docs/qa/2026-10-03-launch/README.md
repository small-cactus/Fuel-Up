# Launch and onboarding map verification

Baseline: `8304095`, Release build on Anthony's iPhone 18 Pro Max (iOS 27.0.1), over Wi-Fi. Both baseline recordings completed. The updated Release build was installed successfully over Wi-Fi on October 3. The phone subsequently required its passcode; Instruments could not launch the app for an after recording. **No measured before/after launch-time improvement is claimed.**

## Physical baseline evidence

The first three seconds of sampled process activity contained:

| Trace | Main-thread CPU | Legacy blur CPU (inclusive) | Total sampled CPU |
| --- | ---: | ---: | ---: |
| App Launch, 12 seconds | 1,071 ms | 811 ms | 1,760 ms |
| Time Profiler, 8 seconds | 1,024 ms | 744 ms | 1,652 ms |

The obsolete root reveal instantiated eight progressive-blur layers even though native Home immediately removed it. Samples include `ProgressiveBlurView`, `VariableBlurView.setupVariableBlur`, Core Image context initialization, Metal library preparation, and SHA256 work. The updated native Home no longer mounts this legacy reveal. The Android and development cluster-probe paths retain it.

These are sampled CPU costs, not wall-clock launch duration. First sampled MapKit activity and the initial native frame are not map readiness. The two templates are separate baseline observations, not controlled repeated launch benchmarks. Compressed XML exports and JSON summaries accompany this report. Reproduce summaries with `python3 scripts/summarizeLaunchTrace.py <decompressed-export.xml>`.

## Changes

- Publish the map origin before awaiting cached or network prices, allowing tiles to load concurrently with prices.
- Preserve native launch artwork, then display matching in-app artwork while the actual map mounts beneath it. Dismiss on a fully rendered map, with a four-second fallback if readiness never arrives. There is no minimum artificial delay. Wait for the replacement image and layout before hiding the native splash.
- Defer driving infrastructure until the map is visible; keep required background task registration at module scope. Load development diagnostics only when invoked.
- Let UIKit load onboarding page views as needed instead of eagerly constructing all four maps.
- Preload a native MapKit snapshot of the location illustration after the welcome map renders; show the preview until the live location illustration renders. Keep preview requests cancellable and theme/size-specific.
- Slightly widen the Mission Creek view (camera distance 1,500 to 1,800) and extend the gradual material blur transition. Preserve the fixed Continue button and full-screen map.

## Verification

- Release physical-device build: passed. Final installation: passed, preserving app data.
- Debug simulator build: passed.
- 27 targeted tests: passed; see `tests.tap`. Coverage includes map origin before delayed price cache, native prop shape, splash artwork handoff, immediate map-ready dismissal, offline timeout, native onboarding, state continuity, driving gate, and iOS support floor.
- Large iPhone simulator: welcome → location → fuel → gas preferences → Home. Granting location advanced automatically. Location dark-mode screenshot is included. The final launch recording showed correctly sized launch artwork handing off to the rendered map, without the oversized artwork found and corrected during QA.
- Simulator recordings are visual checks, not physical-device performance evidence. The debug simulator showed a notification entitlement warning and failed live membership/station queries during this session; successful fresh price loading was not established by this QA.
- Cluster split/merge behavior was not changed; its live probe was not rerun. Compact-phone visual QA was not repeated in this task.

## Remaining measurement

With the physical phone unlocked, repeat the same App Launch and Time Profiler captures on the installed build. Compare matching templates and verify the real splash-to-map handoff. The failed after attempt (`Waiting for device to boot` / launch timeout while passcode required) is not a performance sample. Native launch timing must remain separate from time to a fully rendered map and time to fresh prices.
