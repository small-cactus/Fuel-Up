# Fuel Up 1.0.5 (43) — driving continuity

## Contents

Source fix: `4afeb08`; version and QA checkpoint: `68df752`.

Preserves compatible station snapshots through device movement, keeps selection and swipes stable, and isolates unchanged card/Trends/navigation/Settings rendering. Real price, distance, age, filter, and expiry changes remain reactive. No provider, collection, permission, billing, or notification behavior was changed.

## Verification

See `../../qa/2026-11-14-driving-continuity/README.md` and its artifacts for four simulator driving iterations, live native-map checks, unit tests, screenshots, and profiling limits. The final drive had zero empty-list samples or card/carousel unmounts and retained station 18894. All 188 unit tests, 47 Trends tests, and 10 release/lifecycle checks passed.

The native suite passed 25/26 initially; the remaining assertion incorrectly required a horizontal binding fit. Exact geometry proved the vertical edges were binding. The corrected all-edge assertion retained the same tolerance and clipping checks, and its live rerun passed. The separate, pre-existing legacy React Native map animation gate remains failed and is documented without relaxed thresholds. That legacy screen is excluded from iOS Release.

## Listing preparation

`listing.json` contains non-empty promotional text and release notes for English (US), Simplified Chinese, Traditional Chinese, French, Spanish (Mexico), and Vietnamese. All promotional texts are within 170 characters. It records the requested automatic release after approval and no phased release. All six promotional texts and release notes were saved and read back in App Store Connect on November 14. Automatic release after approval and immediate availability to all users were also verified selected before submission.

`review-notes.txt` describes the change. The saved App Review notes identify 1.0.5 (43), include the movement-continuity change, and preserve the existing review access and notification/research guidance.

## Submission confirmed

Apple confirmed **1.0.5 (43) — Waiting for Review** at approximately **2026-11-14 18:43 UTC**, with “1 Item Submitted” and zero draft submissions. Submission ID: `bf204e5d-d348-4cc0-8c76-350d74dc6e38`.

Automatic release after approval is enabled; phased release is off. Promotional text and release notes are non-empty in all six existing localizations. Build 43 was processed and attached. Public App Store availability has **not** been verified; Apple review is pending.

The earlier expired-login blocker was resolved by the user's sign-in. Safari's App Store web content stalled during localization edits; restarting only the stalled App Store web-content processes restored the session. All metadata was saved and read back before submission.

## Local packaging

Archive target: `/Users/anthonyh/Library/Developer/Xcode/Archives/2026-11-14/FuelUp-43-Driving.xcarchive`.

The generated native app/project and notification extension were synchronized to 1.0.5 (43). The first archive was intentionally interrupted to correct the notification extension's explicit Info.plist values; compilation resumed using the same `/tmp/FuelUpGlassDevice` cache. Archive and App Store export succeeded. The exported app and both extensions passed strict signature checks and report 1.0.5 (43), with debugging disabled. The app has production APNs entitlement. `export-validation.json` records the IPA digest and bundle checks. The archived Release JavaScript bundle does not contain the legacy probe marker, consistent with the passing production route-exclusion packaging test.

Validated IPA: `/tmp/FuelUp-AppStore-43-Driving/FuelUp.ipa`. Archive/export/upload logs: `/tmp/fuelup-43-{archive,export,upload}.log`. Apple accepted the upload at **2026-11-14 10:41:46 UTC** and reported that the uploaded package is processing. See `upload-result.txt`. Processing completion, App Review submission, automatic release settings, and saved promotional text were subsequently verified as recorded above. Public availability remains pending review.

Upload emitted the existing non-blocking missing `hermesvm.framework` dSYM warning. Hermes crash symbolication may be limited.

A durable copy of the validated IPA is saved beside the Xcode archive: `/Users/anthonyh/Library/Developer/Xcode/Archives/2026-11-14/FuelUp-43-Driving.ipa`.

Simulator driving was stopped, this task’s Metro and scoped Argent services were shut down, and the simulator’s existing boot state was preserved. No physical phone was opened.
