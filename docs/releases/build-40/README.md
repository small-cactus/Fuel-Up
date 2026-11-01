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

## Packaging and submission status

Archive and App Store export succeeded. Upload succeeded at 2026-11-01 15:56:07 EST; Apple processing is pending. App Review submission is not yet complete. The initial archive encountered a missing Xcode Metal Toolchain required by the existing launch animation. Installed Apple's Metal Toolchain 27B47 using xcodebuild download/export; xcodebuild reports installed and xcrun verifies Metal compiler 32023.922.4. The archive retry succeeded. No shader or security workaround was applied.

App Store Connect: release notes saved for English (U.S.), Simplified Chinese, Traditional Chinese, French, Spanish (Mexico), and Vietnamese. Review notes updated for build 40. Manual release remains selected. The separately submitted screenshot product-page test is not a proven conversion winner and is not being substituted into the release.

App Store Connect preflight accepted the metadata and reported only: `You must choose a build.`

- Archive: `~/Library/Developer/Xcode/Archives/2026-11-01/FuelUp-40.xcarchive`.
- Export: `/tmp/FuelUp-AppStore-40-export/FuelUp.ipa`. SHA-256 and all three bundle checks are retained in `export-validation.json`.
- All bundles: 1.0.2 (40), valid strict signatures, debugging disabled. App uses production APNs.
- Bundled JavaScript and the compiled native executable contain the new copy. No physical-device visual pass was performed for this copy/version release.

Upload reported the existing nonblocking Hermes dSYM warning (UUID `B99B4F0D-1B56-3D94-940F-383F4F00C905`), also present in build 39. This limits symbolication for that framework; Apple accepted the package.
