# Build 35 — native map gesture performance

Reuses bounded native glass containers and unchanged station pills across map movements, and removes a diagnostic-only clustering pass from normal rendering. Camera persistence, station-card navigation, native glass, cluster transitions and station/recommendation colors are retained.

Matched simulator measurements and raw evidence: [performance report](../../performance/native-map-2026-10-23/README.md). Repeat cycles created 78% fewer new pills and 98% fewer containers; overlay CPU p95 improved 12%. These are app overlay measurements, not physical-phone FPS or proof that MapKit tile/GPU warmup is eliminated.

Validation: 26 native integration/routing checks, 165 standard tests and seven native unit runners passed. Touch gesture flow passed twice. The retained debug-only legacy renderer still fails its unchanged animation gate; it is excluded from shipping iOS Release. No test threshold was relaxed.

Build 35 archived and exported successfully. The app and both extensions passed strict distribution-signature checks with debugging disabled. The app has production APNs; native benchmark code is absent from the executable. Apple accepted the upload on October 23, 2026 at 13:17 EDT. The existing non-blocking missing Hermes dSYM warning remains; Hermes crash symbolication may be incomplete. Safari App Store Connect now shows build 35 **Testing**, assigned to Fuel Up Internal Testing (1 tester) and Fuel Up External Testing (6 testers), 7 invites total. What to Test notes were saved and the external submission completed with Automatically notify testers enabled. This verifies tester availability, not installation or notification delivery on each phone. See `testflight-distribution.json`.

Archive: `/Users/anthonyh/Library/Developer/Xcode/Archives/2026-10-23/FuelUp-35.xcarchive`. Export: `/tmp/FuelUp-TestFlight-35-export/FuelUp.ipa`. Build/export/upload logs: `/tmp/fuelup-map-build35/`.
