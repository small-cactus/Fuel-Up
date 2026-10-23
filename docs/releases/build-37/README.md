# Build 37 — initial map glass allocation

Version 1.0.0, build 37. Implementation: `97d8396` on `master`.

The native map defers its first glass layout until carousel measurement and camera fitting finish. The affected fresh-simulator startup used 20 glass surfaces instead of 55 for the same 61-station result; this is an allocation reduction, not a promised total-launch speedup. See `docs/performance/native-map-2026-10-23-startup` for measurements, scope, and limitations.

Validation: 165 standard tests, seven native unit runners, and all 26 native integration/routing checks passed (one initially missing probe export passed on exact rerun). The recorded pinch/pan flow passed. The retained non-shipping legacy debug renderer still fails its pre-existing strict animation gate; the assertions were not changed.

Release archive and App Store Connect export succeeded. Strict distribution signature verification passed for the app, widget and notification-service extension at build 37. Debugging is disabled, APNs is production, and startup/performance benchmark code is absent from the executable. `export-validation.json` records the IPA digest.

TestFlight upload succeeded at 2026-10-23 20:07:38 UTC. At 20:13 UTC, App Store Connect showed **1.0.0 (37) Testing**, with Fuel Up Internal Testing and Fuel Up External Testing attached and seven invites (one internal tester and six external testers). What to Test notes were saved; Automatically notify testers was checked on external submission. `testflight-status.txt` records the observed state. This verifies group availability, not that a tester has installed the build.

[Build in App Store Connect](https://appstoreconnect.apple.com/teams/3bf3ccbf-7c6c-471f-a30e-7ced4e800679/apps/6759831421/testflight/ios/bdeae681-81b3-44ff-95ae-ab790f3c493c). Release notes are in `test-notes.txt`.

The two disposable fresh-cache simulators were deleted, the tested simulator app was terminated, and the task-owned Metro/Argent helper services were stopped. Existing build caches and archives were preserved.

Xcode reported a nonblocking missing-symbol warning for the bundled `hermesvm.framework` dSYM (UUID `B99B4F0D-1B56-3D94-940F-383F4F00C905`); upload completed successfully. This affects symbolication for that framework, not acceptance of the binary.
