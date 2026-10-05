# Home startup camera and consent handle

The native Home map reported launch readiness when its tiles finished rendering, independently of station loading and card measurement. Its first fit used a provisional bottom inset; the real SwiftUI card height arrived afterward and caused another nonanimated fit with chips already visible.

Home now publishes its camera inset only after the SwiftUI card and outer carousel layout agree. The map waits for station loading and that measured viewport before its first fit and chip reveal. Later fits use MapKit animation, including data arriving after the existing four-second splash fallback. Existing chips remain attached during deferred camera adjustments. Empty results and fetch errors still allow launch to finish; the splash deadline is unchanged.

The consent sheet handle is a simple SwiftUI capsule inset 16 points from the top. Apple's fixed-position grabber is hidden; native sheet dismissal remains enabled.

## Verification

- Actual iOS simulator cold launch passed twice. Final run: one nonanimated initial fit, content ready, bottom inset 386pt, before chip presentation. No subsequent nonanimated camera fit. Evidence: `evidence/2026-10-05-home-startup/map-launch-probe.json`.
- `npm run test:map-launch` passed (requires `FUELUP_SIMULATOR_UDID` and a configured simulator with Metro). Includes real native startup telemetry and a regression test that rejects provisional card geometry.
- Targeted card/layout, splash, cached-station, device-location, camera geometry and station-focus tests: 21 passed.
- Final native integration checks: all five passed, covering live split/merge rendering, three Show all return/interrupt cases, and fitting the user dot outside the station envelope. The transition run recorded 1,650 frames and 94 transitions.
- ESLint on the three changed JS files: zero errors; 26 warnings, including existing inline props/styles.
- Debug simulator build and signed Release phone build passed. Release installed on Anthony's iPhone 18 Pro Max. Physical launch behavior has not been visually verified.
- Consent handle rendered in light and dark native simulator previews; swipe-to-dismiss passed. Screenshots saved beside the launch evidence.
- Full `npm test`: 158 passed, 2 failed in unchanged cache-price and native Settings tests. The cache test passed when rerun separately; the Settings assertion remained failing.
- The same Settings failure reproduced in a separate checkout of the unchanged HEAD. Its cache test passed there too.
- Required legacy `clusterProbe.integration.test.cjs` did not reach its animation stage: it remained at "Waiting for a multi-station cluster near the map center" and timed out. No thresholds, assertions, or timeout rules were relaxed.

The launch probe is opt-in through `FUELUP_MAP_LAUNCH_PROBE` and exists only in Debug builds. It records bounded camera/layout telemetry locally, without prices, station identities, coordinates, or network collection.
