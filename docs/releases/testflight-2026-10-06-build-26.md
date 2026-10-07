# TestFlight release 1.0.0 (26)

Source: `6bbbcf9` on `master`, including localization checkpoint `480b949`. EAS build number was set to 26 and read back before archiving.

## Validation

- Release packaging and localization tests: 9/9 passed.
- Release archive succeeded with production APNs environment; deep/strict signature verification passed.
- App, notification service, and widget bundles all report 1.0.0 (26).
- Seven localization bundles verified in the archive: English, Spanish, Simplified Chinese, Traditional Chinese, Filipino, Vietnamese, and French.
- Export compliance declaration remains ITSAppUsesNonExemptEncryption=false.
- main.jsbundle SHA-256: `61ed5daec4266bd87fc8aefd636207e64022342ff7ac0821cedf8a2d3d1b6439`.

## Distribution

Apple accepted the upload and export exited 0. App Store Connect subsequently showed build 26 processed, Ready to Submit, assigned to Fuel Up Internal Testing with one invite. External testing was not submitted or enabled in this task.

Build 26 replaced build 25 on the App Store version 1.0 draft. Save completed; state remains Prepare for Submission. Add for Review was not clicked. Existing support URL, content rights, and privacy policy blockers remain documented in review-preparation.json.

Non-blocking upload warning: Hermes framework dSYM missing; Apple accepted the package. This limits Hermes symbolication.

Evidence: `build-26/app-store-draft.png`. Local build logs and archive remain at `/tmp/fuelup-testflight-26-archive.log`, `/tmp/fuelup-testflight-26-upload.log`, `/tmp/fuelup-testflight-26-tests.log`, and `/tmp/FuelUp-TestFlight-26.xcarchive`.

## Screenshot audit

Inspected the existing large and compact iPhone captures: Home, National Trends, and Station Brands. They are readable but do not show the latest E85 comparison or dark appearance. No screenshots were changed in this task. Recommend Home, E85 dual-price comparison (dark appearance), Trends, then station preferences, with fresh captures from the release app for every populated size. Three images are not inherently wrong, but this selection does not cover the strongest current features.
