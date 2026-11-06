# Fuel Up 1.0.4 (42)

Prepared November 6, 2026 for App Store review with automatic release after approval.

## Contents

- Includes onboarding consistency fix `366366182d032e0bf6f154768c626b4960f29abe`: matching backdrop, heading placement, split bottom choices, and removed card separator.
- Version and build incremented to 1.0.4 (42). The generated native app and both extensions were updated before archiving.
- Permission and notification behavior are unchanged.
- Prior visual QA is in `../../qa/2026-11-06-onboarding-price-drops/`. The documented maximum-accessibility-text footer overlap remains a known limitation.

## Validation

- 24 release-packaging, native onboarding, onboarding flow/handoff/location/save, and price-alert tests passed; see `tests.log`.
- Signed Release archive and App Store export succeeded using the existing device build cache.
- Exported app and both extensions passed strict code-signature validation. All report 1.0.4 (42); development debugging is disabled, and the main app uses production APNs. See `export-validation.json`.
- App Store Connect upload succeeded at 17:22:43 UTC. Apple displayed build 42 as Processing afterward.
- Upload emitted the existing non-blocking warning that the Hermes framework dSYM was absent. Upload itself succeeded; Hermes crash symbolication may be limited.

## Listing

- Release notes saved for English (US), Simplified Chinese, Traditional Chinese, French, Spanish (Mexico), and Vietnamese.
- Review notes describe this onboarding presentation fix and retain the existing feature/permission review guidance.
- Automatically release this version and immediate release to all users selected; existing rating retained.
- Apple finished processing build 42, which was selected and saved for version 1.0.4.
- Submitted to App Review on November 6, 2026. The resulting UI displayed **1 Item Submitted** and **1.0.4 Waiting for Review**. This confirms submission, not approval or availability on the App Store.
- Submission details: https://appstoreconnect.apple.com/apps/6759831421/distribution/reviewsubmissions/details/5c9dc701-271d-4882-9e58-c83e2ccb1b93
- Automatic release and immediate release to all users were independently read back as selected immediately before adding the version for review.

## Local artifacts

- Archive: `/Users/anthonyh/Library/Developer/Xcode/Archives/2026-11-06/FuelUp-42-Onboarding.xcarchive`
- Validated IPA: `/tmp/FuelUp-AppStore-42-Onboarding/FuelUp.ipa`
- Archive, export, and upload logs: `/tmp/fuelup-42-{archive,export,upload}.log`

The large signed artifacts and logs are local; this folder contains the scoped release evidence without account contact details or credentials.
