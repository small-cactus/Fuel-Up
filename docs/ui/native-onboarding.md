# Native onboarding

The existing welcome artwork and presentation are preserved. On iOS 16 and later,
the remaining setup uses a native SwiftUI navigation stack with four pages:

1. **Gas near you:** foreground location permission, with a Not now path.
2. **Your search radius:** persistent MapKit preview and a native slider.
3. **Choose your fuel:** one selection list and an optional E85 requirement.
4. **Your usual stops:** state-relevant memberships, favorites, and native search.

The predictive-fueling tutorial and Live Activity pitch are omitted from this
flow. It does not request background location, motion, or notification permission.
Copy describes the user's choice rather than ranking, caching, or implementation.

## Ownership and layout

Each page, shared styling, draft model, map, and Expo host lives separately under
`modules/fuel-up-map-kit-routing/ios/Onboarding`. Swift owns navigation, controls,
permission interaction, and draft choices. JavaScript retains the existing cached
station service, membership service, and preference persistence. Completion saves
all choices through the existing preference context. Back navigation retains the
draft. Android and older iOS retain the separate legacy flow.

Native regular Liquid Glass is used on supported systems, with simple system
backgrounds otherwise. No custom shadows or glass borders were added. Pages scroll
for larger text; the bottom action stays reachable. The map's height depends only
on the available viewport, not station loading or slider state.

## Radius and prefetch

Once location is available, the bridge fetches the maximum selectable radius from
the cached database and starts state-specific membership loading. Radius dragging
filters that inventory locally. Fuel changes refresh the applicable inventory
before the brands page. A transient state lookup gets one bounded retry.

The persistent MapKit preview uses pump symbols and cluster counts, without prices.
It shares Home's contact/ownership geometry with an icon-sized footprint; the
default Home footprint and behavior remain unchanged. Distance calculations are
cached, frame work is coalesced, and the frame clock sleeps when idle. During a
drag, the camera follows the slider directly; release rounds to a whole mile and
uses native camera animation unless Reduce Motion is enabled. The initial fit is
not animated. Skipping location shows a simple placeholder rather than fake data.

## Verification — October 1, 2026

- Simulator build succeeded; 151 standard tests and 24 targeted tests passed.
- Real iPhone 13 mini simulator walkthrough: preserved welcome, all four pages,
  permission grant and denial/skip, radius extremes and rapid reversals, all fuel
  choices, membership and favorite selection, native search, back navigation,
  completion, and read-back of saved preferences.
- Light/dark appearance and accessibility-extra-large text checked. Radius map
  accessibility frame stayed unchanged across radius changes and loading.
- Five live production Home probe cases passed: three overview-return cases,
  50-cycle cheapest-ID stress, and 50-cycle personalized recommendation stress.
  The latter captured 2,220 frames, 126 splits, and 177 merges with exclusive
  recommendation tint.
- The separate legacy cluster probe was attempted unchanged and timed out after
  129 seconds waiting for its report token. Its existing disabled legacy
  transition path is not used by native onboarding or production Home; see the
  earlier limitation in `native-glass-surfaces.md`. This is a failed gate, not a
  passing test. The final incremental build and 17 focused regression checks also
  passed; the final simulator build retained the same map frame at 7 and 15 miles.

No phone install is implied by simulator verification. No provider collection,
raw prices, ranking policy, or research campaign settings changed.
