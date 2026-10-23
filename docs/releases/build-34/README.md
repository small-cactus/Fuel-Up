# Build 34 — native MapKit QA and routing

The shipping iOS Home already uses the Swift MapKit and native glass renderer. This release retains it and makes the ordinary iOS development probe link exercise that same renderer. The legacy React Native probe is available only through an explicit legacy flag; its original strict assertions and JSON export are unchanged.

Switching from an active legacy debug session to a standard native link now clears the legacy session. Flag parsing preserves whitespace, repeated query values, and existing truthy spellings. Probe fixtures remain disabled in Release in both JavaScript and Swift.

Research fill-up dates and stable camera behavior from build 33 are retained: location/station updates preserve the user's camera; explicit station-card selection and Show All still move it.

## Verification

- 165 standard unit tests and 12 targeted routing, camera, research and packaging tests passed.
- The extra live legacy-to-native switch regression passed with 1,650 native frames and 112 transition events.
- Initial native camera persistence and cold-launch tests passed (2/2).
- All 26 native suite checks passed: 20 native transition scenarios, live camera persistence, cold launch, and four routing tests. The suite runs directly on Home. The old `/cluster-lab` redirect temporarily deactivates the map and loses the simulator location annotation across repeated probes. Direct Home routing retained the real blue dot in the isolated contact scenario. No geometry, continuity, timing, or blue-dot assertion was weakened.
- The retained legacy animation gate remains failing and is excluded from shipping iOS Release. This is not a clean legacy/full `npm test` result; see legacy-gate.log.

Build 34 archived and exported successfully. The exported app and both extensions have valid distribution signatures, build 34, and debugging disabled. The app has production APNs entitlement. See export-validation.json.

Apple accepted the upload on October 23, 2026 at 10:55 EDT and started processing it. After processing, testing notes were saved and the external submission completed. App Store Connect shows build 34 as **Testing**, with the existing internal group (1 tester) and external group (6 testers), 7 invites total. Tester installation has not been independently verified. See testflight-distribution.json. Upload reported the same non-blocking missing Hermes dSYM warning as build 33; Hermes crash symbolication may be incomplete.

Archive: `/Users/anthonyh/Library/Developer/Xcode/Archives/2026-10-23/FuelUp-34.xcarchive`. Export: `/tmp/FuelUp-TestFlight-34-export/FuelUp.ipa`.
