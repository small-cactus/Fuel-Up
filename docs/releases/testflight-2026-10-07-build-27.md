# TestFlight and App Store draft build 1.0.0 (27)

Release checkpoint: `e4af434` on master, including pre-review app changes in
`cb41fe8`. EAS build number 27 was reserved and read back before archiving.
The generated native app and extension build settings were updated to 27.

## Changes

- Native Cancel / Settings alert for denied location permission during onboarding.
- Support and Privacy Policy links at the bottom of Settings.
- Driving Research section name and localized copy in all supported languages.

## Validation

29 focused release packaging, localization, Settings, native onboarding,
onboarding Save, and onboarding handoff tests passed. Source diff checks passed.
This release task does not claim fresh phone visual QA.

## Distribution

Release archive succeeded. An initial package check caught a stale build 26 in
the generated notification-extension plist; it was corrected to 27 before a
fresh successful archive. No mismatched package was uploaded.

The App Store distribution export passed deep/strict signature verification.
App, notification service, and widget bundles report 1.0.0 (27). Production
APNs signing, export compliance, JavaScript bundle hash, and seven localization
bundles were verified in the exported IPA; see `build-27/package-validation.json`.
The archive itself uses development signing until distribution export re-signs it.

Apple accepted the upload and export exited 0. A non-blocking missing Hermes
dSYM warning remains and limits Hermes crash symbolication. App Store Connect
finished processing. Saved What to Test notes and assigned build 27 to both
Fuel Up Internal Testing (one tester) and Fuel Up External Testing (four
testers). Submitted the external TestFlight review step with automatic tester
notification enabled; the build subsequently showed Testing for both groups
with five invites. This is dashboard availability, not proof of installation
on any tester phone.

Replaced build 26 with 27 on the App Store version 1.0 draft and saved. Verified
build 27, Prepare for Submission, and the unchanged manual-release choice.
Add for Review was not clicked. No public App Store review submission occurred.
Evidence: `build-27/testflight.png` and `build-27/app-store-draft.png`.

Local evidence: `/tmp/FuelUp-TestFlight-27.xcarchive`,
`/tmp/FuelUp-TestFlight-27-export/FuelUp.ipa`,
`/tmp/fuelup-testflight-27-archive.log`,
`/tmp/fuelup-testflight-27-upload.log`, and
`/tmp/fuelup-testflight-27-tests.log`.

