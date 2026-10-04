# Maps move with onboarding slides

Previously the location, fuel, and station-preference slides shared a stationary map, while their content slid over it. Each of the four slides now has its own retained MapKit renderer. All are mounted at full size with the flow, and offscreen maps remain mounted for preloading and reuse.

The native pager reports each attached page's actual horizontal origin. The backdrop applies those same positions synchronously in UIKit, rather than publishing estimated animation progress through SwiftUI. This follows forward/reverse transitions, cancelled swipes, and edge bounce. It also avoids assuming a page-dot transition traverses every intermediate page. The existing permission gate and native paging controller remain intact.

## Verified

- All 27 focused onboarding checks passed: nativeOnboarding, onboardingStateContinuity, onboardingInteraction, onboardingFlow, onboardingLocation, and onboardingAssets.
- Debug iPhone 17 Pro Max simulator build succeeded (iOS 26.5).
- Live simulator navigation exercised all four pages, forward/reverse swipes, a short cancelled swipe, Continue, and page-control navigation. The native location prompt was accepted and advanced to fuel selection.
- Recorded transition frames show the map moving with its page content. Returning to location and welcome reused already rendered maps without a blank-map flash in the observed transitions.
- Native hierarchy inspection found four MKMapViews before navigation and the same four pointers after the navigation cycle: `0x12c941500`, `0x12c940700`, `0x109d2b800`, `0x109d2aa00`. This verifies retained view identity, not a claim about future MapKit tile requests.
- Dark theme was selected through the app's ThemeContext setter; reverse navigation from station preferences through fuel to location retained dark map rendering and legible content.
- Signed Release build succeeded in 103 seconds, with signature verification. CLI installation over the existing iPhone 18 Pro Max app succeeded, and the device app query confirmed `com.anthonyh.fuelup` version 1.0.0/build 1. Phone launch and interaction were not tested.

The simulator's existing unsigned-debug Expo notifications Keychain warning was dismissed before navigation QA. Compact layouts, Reduce Motion, and VoiceOver were not exercised in this follow-up. Cluster code was unchanged, so the live cluster split/merge probe was not run.

## Evidence

- [Navigation recording, 55.4 seconds](evidence/2026-10-04-onboarding-sliding-maps/navigation.mp4)
- [Cancelled swipe and button navigation, 31.0 seconds](evidence/2026-10-04-onboarding-sliding-maps/cancel-and-buttons.mp4)
- [Forward transition frames](evidence/2026-10-04-onboarding-sliding-maps/forward-frames.png)
- [Cancelled swipe frames](evidence/2026-10-04-onboarding-sliding-maps/cancel-frames.png)
- [Dark location page](evidence/2026-10-04-onboarding-sliding-maps/location-dark.png)
