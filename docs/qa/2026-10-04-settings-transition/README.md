# Settings push transition — October 4, 2026

## Cause and fix

Both shared Settings pages moved down 10 points after the native navigation push. React Native already placed `NativePreferenceView` below the Settings canopy. The child `UIHostingController` then received an additional navigation-container safe-area inset when UIKit completed the transition. Its SwiftUI scroll content applied that inset a second time.

The host now accepts only the keyboard safe-area region using Apple's public `UIHostingController.safeAreaRegions` API. React Native owns the top and bottom screen padding. Keyboard avoidance remains enabled; the native push animation and header are unchanged. Content stays at its initial position rather than jumping to the extra inset.

## Frame evidence

Recorded at 30 fps on iPhone 17 Pro Max simulator, iOS 26.5. Analysis scales each recording to the simulator's 440 × 956 point coordinate space. It tracks the topmost colored pixels of the first fuel icon or Costco logo through the push and settled frames. These are measurements of the rendered video, not model layout assertions. Full frame samples are in [measurements.json](measurements.json).

| Page | Before | After |
| --- | --- | --- |
| Fuel Type | Icon y=139 → 149; 10-point jump | y=139 throughout; 0-point vertical range |
| Station Brands | Logo y=183 → 193; 10-point jump | y=183 throughout; 0-point vertical range |

Videos: [fuel before](fuel-before.mp4), [fuel after](fuel-after.mp4), [brands before](brands-before.mp4), [brands after](brands-after.mp4). The brands comparison uses loaded membership rows so network completion does not affect the measurement. A separate first-load capture also retained the same final position.

Verified native Back, station search typing/filtering, keyboard presentation and dismissal. Search stays visible above the keyboard. All 12 focused Settings lifecycle, preference persistence, and native onboarding checks passed; scoped lint and `git diff --check` passed. No cluster behavior changed, so the live cluster probe was not run.

Debug simulator and signed Release device builds succeeded. Release took 70 seconds. Signature verification passed, and the app was installed in place on the paired iPhone 18 Pro Max (`00008160-001E206E02A0000A`). Device app inventory confirmed `com.anthonyh.fuelup`, version 1.0.0, build 1. Physical installation is verified; frame measurements are simulator evidence.
