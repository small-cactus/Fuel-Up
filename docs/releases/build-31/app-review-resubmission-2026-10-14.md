# App Store resubmission: version 1.0, build 31

User authorized canceling the waiting build 27 submission and replacing it with tested build 31 on October 14, 2026.

## Verified App Store Connect outcome

- App: Fuel Up: Find Cheap Gas Prices (`6759831421`).
- Canceled submission: `a52dabb2-077a-4f3c-bbc2-c936965936af`, originally submitted October 7 with build 27. Cancellation visibly changed the version to Developer Rejected.
- Replaced the attached build with **1.0.0 (31)** and saved the version.
- Added the version for review, then clicked Submit for Review. Apple displayed **1 Item Submitted**.
- New submission: `61336f6f-c3e7-4859-a1d1-5f487dc8b1bc`.
- Submission details show **October 14, 2026 at 12:24 PM Eastern (16:24 UTC)**, **iOS App 1.0 / 1.0.0 (31)**, and **Waiting for Review**.
- Manual release remained selected before submission. This is a review submission, not approval or public release.

[New submission](https://appstoreconnect.apple.com/apps/6759831421/distribution/reviewsubmissions/details/61336f6f-c3e7-4859-a1d1-5f487dc8b1bc)

The review process restarted; cancellation/resubmission does not guarantee expedited review. Apple's confirmation displayed an estimate of up to 48 hours, not a guaranteed completion date.

## Submission checks and changes

Existing published App Privacy disclosures were inspected: Product Interaction and Device ID include Analytics; location, fitness and other relevant research data were disclosed. The privacy policy had already been published with the October 12 telemetry update. No privacy disclosures were changed during this submission.

Updated reviewer notes explain the build 30 motion-processing crash fix included in build 31, the consent-gated persistent mileage ledger, standard visible-notification authorization, and installation analytics/silent usage-upload pushes independent of research enrollment. Preserved the no-login review steps, optional research pause/sync/deletion controls, U.S. coverage and no-payment information. Existing public description, screenshots, contacts and manual-release selection were preserved.

Build 31 was already uploaded and Testing in TestFlight. Its signed archive, production APNs entitlements and 23 related test results are documented in `../testflight-2026-10-13-build-31.md`; no new binary or source change was made for this resubmission. No phone app was opened.

The earlier unsent support follow-up draft remains a historical draft; no additional support message was sent as part of this task.

Verification used the live authenticated Safari App Store Connect UI, including the final submission detail page. No account credentials or private contact fields are stored in this evidence.
