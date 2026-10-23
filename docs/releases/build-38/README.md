# Build 38 — native map panning

Version 1.0.0, build 38. Implementation and measurement checkpoint: `c52ee6d` on `master`.

The native map reuses settled price/count glass geometry during uniform panning, carried by its existing MapKit annotation. Full reconciliation remains active; changed visibility, grouping, user-location clearance, camera scale, selection and theme invalidate reuse. Zoom and cluster animations retain the full renderer. The matched simulator A/B reduced mean overlay CPU from 2.242 to 1.138 ms per camera frame (49.24%). This is not a measured phone FPS result; the reported sub-20 FPS was not reproduced on the simulator.

Validation: 165 standard tests, seven existing native unit runners, the new production-snapshot unit runner, and all 26 live native integration/routing checks passed. Recorded pan-only and mixed pan/zoom flows passed, and swiping a station card still focused the map. The retained non-shipping legacy JavaScript probe failed its existing animation limits and outside-layer coverage in this run. No assertions were weakened. Full measurements and failed/passed check evidence are in `docs/performance/native-map-2026-10-23-panning`.

Release archive and App Store Connect export succeeded. Strict signature validation passed for the app, widget and notification extension at 1.0.0 (38), with debugging disabled and production APNs on the app. DEBUG benchmark hooks and fixture loading are absent from the executable. `export-validation.json` records the IPA digest. App Store Connect upload succeeded at 2026-10-23 21:14:58 UTC. At 21:26 UTC App Store Connect showed **1.0.0 (38) Testing**, with both Fuel Up Internal Testing and Fuel Up External Testing attached and seven invites. What to Test notes were saved, and Automatically notify testers was checked during external submission. This verifies group availability, not tester installation. `testflight-status.txt` records the observed states. Xcode reported the existing nonblocking missing hermesvm.framework dSYM warning (UUID B99B4F0D-1B56-3D94-940F-383F4F00C905); this affects framework symbolication, not upload acceptance.

After testing, the simulator app was terminated and this task's Metro and scoped Argent helper services were stopped. Existing build caches, simulator data and archives were preserved.

[Build 38 in App Store Connect](https://appstoreconnect.apple.com/teams/3bf3ccbf-7c6c-471f-a30e-7ced4e800679/apps/6759831421/testflight/ios/81c7bc59-a58a-4274-a267-b2380dae31d8).
