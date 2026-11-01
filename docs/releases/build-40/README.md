# Fuel Up 1.0.2 (40)

Release prepared 2026-11-01 from source including `430c0ac` (copy clarification) and `088e3ba` (paywall preview removal).

## Changes

- Clarifies the welcome message, Settings refresh confirmation/failure, and Local Trends empty state across supported languages.
- Includes the new English App Store keywords and description in the existing 1.0.2 draft, documented in `docs/app-store/2026-11-01-acquisition`.
- No subscription or paywall is included. Local remains the default Trends scope.

## Validation

- Standard suite: 165/165 passing.
- Localization suite: 6/6 passing.
- Seven native language resources regenerated.
- No cluster animation changes; the live cluster probe was not rerun for this copy/version release.
- App and extension version/build inputs updated to 1.0.2 (40). Generated iOS files are ignored; app.json is the tracked source of version/build configuration.

## Pending release work

Archive, export/signature verification, upload, and App Review submission are not yet complete. The initial archive encountered a missing Xcode Metal Toolchain required by the existing launch animation. Apple's component installation is in progress; reuse the compiled cache for the retry.

App Store Connect: release notes saved for English (U.S.), Simplified Chinese, Traditional Chinese, French, Spanish (Mexico), and Vietnamese. Review notes updated for build 40. Manual release remains selected. The separately submitted screenshot product-page test is not a proven conversion winner and is not being substituted into the release.
