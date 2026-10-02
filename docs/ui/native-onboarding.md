# Native onboarding

All five pages, including the preserved welcome artwork, now belong to one native
SwiftUI paging TabView. Swipes, page dots and Continue update the same draft.
There are no pushed setup screens. The brands field is a UIKit UISearchBar, without
an extra navigation controller or its empty navigation-bar space.

1. Welcome: native MapKit with immediately installed demo annotations, so returning
   to the page does not depend on a one-shot map-ready event.
2. Location: an edge-to-edge native MapKit backdrop, one short headline and one
   sentence. Before location is available, the map shows national geography; with
   access and a fix, it shows the user's area. No fabricated station pins/prices.
   Always asks “Use my location”, including replay with existing access.
   Granted access continues directly; undecided access requests Apple's prompt;
   denied access links to Settings. iOS does not allow an app to reset a user's
   prior permission decision. There is no redundant confirmation page.
3. Radius: full-screen MapKit, no station annotations, fixed camera centered on
   the user and fitted to the maximum 15-mile circle. Pinch changes only the circle;
   release springs to the closest whole-mile notch, within 2–15 miles. A native
   slider and VoiceOver adjustment provide alternatives. Reduce Motion removes
   the spring. Moving location or changing viewport size refits the camera.
4. Fuel: five choices with bundled vector pump illustrations and optional E85.
5. Usual stops: state-relevant memberships and nearby favorites with offline logos.

Pages, map, search, artwork, model and bridge remain separate files. Swift owns
interaction and draft state; the existing JavaScript services own cached DB reads,
state-specific membership lookup and preference persistence. Location starts
prefetching the maximum-radius inventory before brands become visible. Dragging
and pinching do not fetch provider data. No Home ranking, collection, or raw prices
changed. Android/older iOS retain the legacy flow.

Native Liquid Glass uses no added borders or shadows. Fuel and brand lists scroll
independently within the page. See [artwork provenance and coverage](brand-assets/README.md).

## Location redesign — October 2, 2026

Removed the onboarding Back button and its reserved header space. Native swipes
and the accessible page control still revisit every step. Welcome artwork and
permission behavior remain unchanged. The location map and layout are separate
Swift files, using Apple's [MKStandardMapConfiguration](https://developer.apple.com/documentation/mapkit/mkstandardmapconfiguration)
with muted emphasis. Map movement respects Reduce Motion. The request uses a
solid reading surface in accessibility text sizes, scrolls as needed, and reserves
the actual footer height so large button text cannot cover the explanation.

### Redesign verification

- Debug iOS simulator build passed; all 25 targeted onboarding tests passed.
- Final build rendered on iPhone 13 mini and iPhone 17 Pro Max simulators.
  [Compact/light](onboarding-location-redesign/compact-light.png) and
  [large/dark](onboarding-location-redesign/large-dark.png) captures are retained.
- Compact simulator: permission prompt appears only after the action; approval
  advances to Radius, denial changes the action to Open Settings, and Not now
  still advances. Returning with permission granted offers Use my location again
  and advances without a redundant confirmation screen.
- Swipe back to Welcome retains all six demo annotations. Fuel and Radius render
  without a back button or its reserved space.
- Maximum Dynamic Type in dark mode exposed a text/footer overlap, fixed by
  restricting the text scroll viewport above the footer. Scrolling now reveals
  the complete explanation without covering Not now or Open Settings.
- The unsigned Debug simulator emits an existing Expo notifications keychain
  entitlement warning at launch; it was dismissed for clean visual captures.
  No physical phone installation or live VoiceOver/Reduce Motion test is claimed.

## Pager revision verification — October 1, 2026

- Simulator build passed; 151 standard and 23 existing onboarding tests passed.
- Two additional asset/native-radius tests passed: PNG dimensions, hashes, bundle
  membership coverage, SVG self-containment, and real Swift clamp/snap behavior.
- The first standard-suite run had one intermittent existing fuel-cache assertion
  failure; its isolated rerun and the complete rerun passed without test changes.
- Live iPhone 13 mini simulator: all five pages swipe in both directions; existing
  location permission still presents the request; welcome retains all six pills
  after returning. Pinch changed 8 → 12 → 4 miles with fixed map geography and no
  station pills. Fuel SVGs, memberships and favorite logos render from the bundle.
- Final build passed after layout repairs. Welcome kept all six annotations during
  five forward/back cycles. First-time permission showed Apple's prompt and moved
  directly to Radius after approval. Dark/light and accessibility-extra-large
  checks found and fixed search-height/keyboard overlap and radius-label clipping.
  Search results remain visible above the keyboard at accessibility text sizes.
  The shared Continue button/page dots retain their position on the location page.
- This revision was verified in the simulator, not installed on a physical phone.
  The production Home cluster renderer was not changed; the historical legacy
  probe limitation below remains a limitation, not a passing gate.

## Earlier native-onboarding verification — October 1, 2026

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
