# Stationary onboarding controls and Apple Park illustration

## Result

Continue and the page indicator now live once above the native page controller. The entire page content slides while the controls remain stationary. Each page reserves the measured footer height, including changes in text size, and a native material fade protects the controls from scrolling content. There are no hidden duplicate buttons.

Location permission uses an edge-to-edge, illustrated 2D Apple Park map, tightly framed with no added symbols or visible road/place labels. The map occupies 46–47% of the initial screen height on the checked phones. MapKit attribution remains. Both image edges blend gradually through native material. The title and illustration scroll with the benefit rows.

## Validation

- Debug simulator and signed Release builds succeeded; 28 focused onboarding, asset, state continuity and preference tests passed. No cluster behavior changed; the live cluster probe was not run for this work.
- iPhone 17 Pro Max simulator: verified light and dark location layouts.  Continue has the same normalized frame (0.055, 0.879, 0.891, 0.069) on welcome, location, fuel, and preferences; the final page changes its label to Find gas.
- iPhone 13 mini simulator: verified title wrapping and scrolling until every benefit is readable. Recorded welcome-to-location and inspected intermediate frames: the page slides horizontally while Continue stays fixed. Native map tiles load during the initial transition. Continue retains frame (0.064, 0.857, 0.872, 0.081) before and after scrolling.
- Real iOS permission dialog was presented from Continue. Allow While Using App automatically advanced to Choose your fuel, then Continue advanced to Gas preferences.
- Existing Debug-only notification/keychain warnings were temporarily hidden for screenshots. Native theme override was temporary and cleared by restarting the simulators afterward.
- Installed Release on Anthony’s iPhone 18 Pro Max. devicectl confirmed success for com.anthonyh.fuelup. The phone app was not opened; visual QA was performed in simulators. Landscape and enlarged Dynamic Type were not independently exercised in this pass.

## Evidence

![Light](evidence/2026-10-02-stationary-onboarding/location-light.png)
![Dark](evidence/2026-10-02-stationary-onboarding/location-dark.png)
![Compact after scrolling](evidence/2026-10-02-stationary-onboarding/compact-scrolled.png)
![Permission auto advance](evidence/2026-10-02-stationary-onboarding/permission-advanced.png)

[Page transition recording](evidence/2026-10-02-stationary-onboarding/stationary-continue.mp4)

Native map appearance uses [Apple’s standard map configuration](https://developer.apple.com/documentation/mapkit/mkstandardmapconfiguration) with flat elevation, muted emphasis, and points of interest excluded..

## San Francisco follow-up

At the user’s request, the map center moved to Hayes Valley in San Francisco (37.7765, -122.4241). The same large flat illustrated map, framing, progressive edge treatment, and stationary footer remain. The accessibility label now names San Francisco. Native muted cartography still includes faint street names in this neighborhood; POIs and custom symbols remain absent.

The signed Release and simulator builds passed, along with the same 28 focused tests. The final map was visually checked in the large simulator and Release installation on Anthony’s iPhone 18 Pro Max succeeded. The phone app was not launched.

![San Francisco](evidence/2026-10-02-stationary-onboarding/location-san-francisco.png)
