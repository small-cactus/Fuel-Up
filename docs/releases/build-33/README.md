# Build 33 — research dates and stable map camera

## Changes

- Research visits and arrival/departure entries show native localized dates and times.
- Background origin, location, station refreshes, and card inset updates preserve the camera after initial presentation.
- Swiping station cards still explicitly focuses the station; Show All retains its overview behavior.

## Verification

- 165 standard unit tests passed; 16 targeted camera/focus/card/research/packaging tests passed. Five final camera/focus/release-packaging checks also passed.
- Final live MapKit camera and cold-launch checks passed (2/2). Overview, manually panned, and selected-station cameras retained identical center, distance, heading, and pitch during refreshes. Explicit focus and Show All moved the camera.
- The initial-fit probe passed across 120 frames after correcting probe readiness to wait for the same content-ready signal used by the real map. No thresholds were relaxed.
- Native Show All checks passed for north, rotated, and interrupted layout states; six repeated overview returns preserved membership, glass connections, tint, and geometry. The outside-user-location check passed.
- Simulator visual checks confirmed dates for visits on October 21 and October 19 and arrival/departure entries. A real card swipe changed the selected station and focused it. Screenshots are included. The synthetic research fixture was local only, collection/consent stayed off, and original preferences were restored afterward.
- No physical phone was opened or modified. Dark-theme visual verification was not established because the app retained its explicit light theme during the system appearance check.

## Known verification limitation

The retained legacy React Native cluster gate is NOT passing. Repairs to debug activation/camera ownership allowed the real animation probe to finish without timeouts: 1,383 samples, 94 transitions, maximum frame delta 121.652 px against the unchanged 2 px limit. The test diagnostic API was corrected so failures are reported rather than hidden by a TypeError. This is not a clean full-suite result. The legacy screen is excluded from the iOS Release bundle; the shipping native map checks above passed. Its animation failure remains unresolved, with evidence retained here. No quality threshold, failed-run handling, or export was weakened.

## Release

Version 1.0.0 build 33 archived and exported successfully. The exported app, widget, and notification extension all have build 33 and valid signatures, debug entitlement disabled; app APNs entitlement is production. IPA SHA-256 and bundle validation are in export-validation.json.

Apple accepted the upload on October 22, 2026 at 18:29 EDT. At the subsequent 23:08 UTC monitoring check, processing had completed. Testing notes were saved, the existing external group was added, and Submit for Review completed. App Store Connect then showed build 33 as Testing with both Fuel Up Internal Testing (1 tester) and Fuel Up External Testing (6 testers). Tester installation has not been independently verified. Upload emitted a non-blocking missing Hermes dSYM warning, so Hermes crash symbolication may be incomplete.

Local archive: /tmp/FuelUp-TestFlight-33.xcarchive. Export: /tmp/FuelUp-TestFlight-33-export/FuelUp.ipa. Detailed local logs: /tmp/fuelup-map-date-20261022/.
