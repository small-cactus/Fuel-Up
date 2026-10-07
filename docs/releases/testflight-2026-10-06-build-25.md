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

- Release archive succeeded; deep/strict signature verification passed. The app, notification service, and widget are all 1.0.0 (25).
- The first upload encountered a temporary DNS failure and was interrupted before final acceptance was recorded. Retried the same verified archive and build number.
- Apple confirmed upload success and package processing on October 6, 2026 at 20:44:54 UTC. Export command exited 0.
- Non-blocking warning: Hermes framework dSYM is missing, as in build 24. Apple accepted the package.
- Follow-up App Store Connect verification: build 25 is processed, shows Testing, and is assigned to both Fuel Up Internal Testing and Fuel Up External Testing (5 invites shown). It was also attached to the unsubmitted App Store version 1.0 draft during review preparation. What to Test was not rechecked in that follow-up.
- App bundle main.jsbundle SHA-256: `3f05f0aedc639c16160bea222cb946e448b6f1ed095e17dc7723ef8857be1e19`.
- Local evidence: `/tmp/FuelUp-TestFlight-25.xcarchive`, `/tmp/fuelup-testflight-25-archive.log`, `/tmp/fuelup-testflight-25-upload-retry.log`, `/tmp/fuelup-testflight-25-tests.log`.
