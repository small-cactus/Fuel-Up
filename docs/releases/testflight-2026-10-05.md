# TestFlight 1.0.0 (23)

Source: master, application source through `3b5e7b7`, screenshot checkpoint `7102150`.

## Test focus

- Home launch, map loading, and station prices.
- Trends loading and background refresh.
- Fuel type and station brand preferences on smaller iPhones.
- Optional driving research: consent, permissions, station visit prompts, answering from a notification, and Wi-Fi sample sync.
- Background notifications with the app closed normally.

## Preparation

- Build number 23 reserved in EAS and configured locally.
- Release archive uses `EXPO_PUBLIC_APNS_ENV=production`.
- Release packaging tests: 3 passed.
- Driving research APNs, permission, and health checks: 5 passed.
- Current Release screenshots verified on large, medium, and compact iPhones and iPad in the screenshot task; see `docs/app-store/2026-10-05/README.md`.

## Distribution

- Archive succeeded; signatures validated for the main app, widget extension, and notification service extension. All report version 1.0.0 (23).
- Xcode automatic App Store distribution signing succeeded; the selected main-app distribution profile has `aps-environment=production`.
- Apple upload succeeded at 2026-10-05 23:14:09 UTC. App Store Connect visibly shows build 23 processing.
- Xcode reported a non-blocking missing Hermes framework dSYM warning. App and extension dSYMs are present; native Hermes crash frames may lack symbols.
- Exported IPA signature verified (`codesign --verify --deep --strict`), with actual signed `aps-environment=production` and `get-task-allow=false`.
- IPA: 45,465,039 bytes; SHA-256 `8c6abe7290d3e2a8014234223bf44ced7b9e5c366d904cb5364c70bcd0f493f6`.
- Apple processing completed successfully. Build ID: `951664ec-8798-4ee4-a147-16bf93936a46`.
- Existing Fuel Up Internal Testing group automatically assigned (one tester).
- Saved What to Test notes covering Home, Trends, preferences, optional research, background notifications, and Wi-Fi sync.
- Submitted the existing Fuel Up External Testing group with automatic tester notification enabled. Apple accepted external testing immediately.
- Final live verification at approximately 2026-10-05 23:19 UTC: iOS build 23 shows **Testing** with both groups attached; the external group's Builds page separately shows **1.0.0 (23), Testing, Expires in 90 days** (two testers).
- No public App Store submission was performed.

[TestFlight build](https://appstoreconnect.apple.com/teams/3bf3ccbf-7c6c-471f-a30e-7ced4e800679/apps/6759831421/testflight/ios/951664ec-8798-4ee4-a147-16bf93936a46)

Local archive: `/tmp/FuelUp-TestFlight-23.xcarchive`. Upload log: `/tmp/fuelup-testflight-23-upload.log`. These generated binaries and logs are not committed.
