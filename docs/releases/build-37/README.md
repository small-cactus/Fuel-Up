# Build 37 — initial map glass allocation

Version 1.0.0, build 37. Implementation: `97d8396` on `master`.

The native map defers its first glass layout until carousel measurement and camera fitting finish. The affected fresh-simulator startup used 20 glass surfaces instead of 55 for the same 61-station result; this is an allocation reduction, not a promised total-launch speedup. See `docs/performance/native-map-2026-10-23-startup` for measurements, scope, and limitations.

Validation: 165 standard tests, seven native unit runners, and all 26 native integration/routing checks passed (one initially missing probe export passed on exact rerun). The recorded pinch/pan flow passed. The retained non-shipping legacy debug renderer still fails its pre-existing strict animation gate; the assertions were not changed.

Release archive and App Store Connect export succeeded. Strict distribution signature verification passed for the app, widget and notification-service extension at build 37. Debugging is disabled, APNs is production, and startup/performance benchmark code is absent from the executable. `export-validation.json` records the IPA digest.

TestFlight upload is in progress; final processing/group availability will be recorded after verification. Release notes are in `test-notes.txt`.
