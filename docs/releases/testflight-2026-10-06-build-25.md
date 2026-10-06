# TestFlight release 1.0.0 (25)

Application source: `1c35da9` on `master`, following `0919045`. Build number 25 reserved and verified in EAS. App config and generated native app/extension build versions updated to 25.

## What to Test

Turn on Also show E85 in Fuel Type settings. E85 stations appear alongside your selected fuel, with yellow map bubbles. Yellow E85 stations lead clusters when present. Select an E85 station to see your selected grade (93 for Premium) and E85 side by side in the station price card. Missing or stale prices remain unavailable. Check map zooming, cluster transitions, station selection, and prices in light and dark mode.

## Validation

- Application checkpoint: 165 unit tests passed; three native geometry/camera/focus suites passed; current native map baseline and yellow-parent live probes passed. See `docs/qa/2026-10-06-e85-parent/README.md`.
- Release packaging tests: 3 passed for this release.
- Known validation limitation: retained legacy cluster integration probe times out; its gates were not changed. Current native map probes passed.
- Archive uses Release configuration with production APNs JS environment, build number 25, marketing version 1.0.0, and existing signing team/cache.

## Distribution

Archive and upload in progress. This record will be updated with Apple processing and group assignment evidence.
