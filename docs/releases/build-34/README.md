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

Upload is in progress; TestFlight distribution is not yet verified.
