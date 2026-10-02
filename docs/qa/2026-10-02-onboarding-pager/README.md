# Onboarding paging and layout verification

October 2, 2026. Native UIKit scroll pager replaces the conditionally populated
SwiftUI TabView. Five persistent hosting controllers preserve page state;
Continue and page-control changes explicitly animate horizontally, and gestures
update the selected step only when completed. Reduce Motion disables programmatic
animation. Requests during a transition are serialized. Location still gates
forward navigation.

Location now uses the same grouped background, heading inset, and glass card
language as the fuel page. Radius keeps its edge-to-edge map and pinch-only
whole-mile control; its heading aligns with fuel/location, and its mileage badge
uses the measured footer inset. The footer preference's default previously
prevented measurements below 196 points and left excess empty space.

## Validation

- Debug simulator and signed Release device builds succeeded.
- Nine tests passed across nativeOnboarding, onboardingAssets, and
  onboardingStateContinuity.
- iPhone 13 mini simulator, light: all four forward transitions, reverse swipe,
  permission prompt, ready state, and Continue gating inspected. A blocked swipe
  before granting permission initially exposed UIKit's cached missing neighbor;
  after the cache-refresh fix, repeated that exact sequence on a fresh install
  and verified the next swipe reaches radius.
- iPhone 17 Pro Max simulator, light/dark: headings share their text origin;
  permission uses a separate button; Continue is disabled before readiness.
  Pinching changed 10 miles to 5, then a later dark-mode pinch settled at 6.
  The hint dismissed and map remained full screen. Completed onboarding reached
  Home; Settings displayed the selected 5-mile radius before replay.
- The dark recording captures four Continue-driven transitions with intermediate
  horizontal positions. The light contact sheet captures welcome sliding out
  as location slides in. These are visual checks, not frame-time benchmarks.
- Signed Release installed successfully on the connected iPhone 18 Pro Max
  (com.anthonyh.fuelup). Physical-device interactions were not exercised.

The dark visual recording used the same layouts/pager before the final isolated
permission-cache refresh; that refresh was checked separately on the final
compact-simulator build. Simulator debug builds showed an existing
expo-notifications missing-keychain-entitlement warning. For the clean dark
recording, the runtime warning overlay was hidden without changing app source.

Cluster rendering was unchanged; its unrelated integration probe was not run.

## Evidence

- [Dark flow video](onboarding-dark.mp4)
- [Dark transition contact sheet](all-slides-dark.jpg)
- [Light welcome transition frames](welcome-slide-frames.jpg)
- [Location, dark](location-dark.png)
- [Radius, dark](radius-dark.png)
