# Station stop confirmations

Native station-stop-v1 remains the detector: at least 120 seconds and three qualifying low-speed fixes near a known station. Accuracy must be at most 40 m; stale, simulated and duplicate fixes do not prove a stop. Gaps over 180 seconds interrupt dwell. This detects a possible stop, never a fuel purchase.

Each new two-minute candidate gets one local actionable notification titled “got fuel? 👀”. A shorter observed stop (at least 30 seconds and three qualifying samples) instead gets “got something at [station name]? 👀” after departure. The catalog station name supplies the brand/display name. Gaps and drive-bys do not trigger the shorter-stop question. Both use the exact subtitle “help Fuel Up get better. Tap and hold to answer”, with no extra body text. The wording is a question, not an inferred purchase label. Actions: Got fuel (`fueled`), Stopped, no fuel (`not_fueling`), Not a stop (`not_a_stop`). Tapping the notification opens Station Visits to answer or correct the station. Native actions save synchronously to SQLite before completing the iOS callback, including a cold background launch. No React bridge or network is required to save an answer.

`visit_prompt` records created, scheduled, permission_missing, schedule_failed, or dismissed, always with `confirmationState=unconfirmed`. Only explicit `visit_label` records provide participant labels. Unanswered or dismissed notifications are not negative examples. `unsure` also remains unconfirmed. The latest explicit label applies; immutable earlier records remain available. A local durable prompt claim prevents repeated prompts across restarts. A crash between claim and delivery may leave a created-only record, which remains unconfirmed rather than retrying an old stop.

After research consent, Settings → Driving Research automatically requests native notification permission together with the rest of setup. Existing notification permission is reused. Denial does not stop recording. Pausing or deleting research cancels these prompts. Real stop prompts use no Live Activity, time-sensitive interruption, CarPlay notification option, or per-answer network call. APNs registration is used separately for operator test alerts. System Focus and notification settings still control delivery.

Validation: Swift detector/outbox tests include drive-bys, gaps, ambiguity, dismissed vs explicit labels, and reopening storage. Node tests cover endpoint validation, authorization, acknowledgements, and disabled Live Activities. The deployed endpoint accepted synthetic prompt/answer records; the temporary participant was deleted. The signed generic iPhone Release build passed. Physical notification presentation and background action handling still require the new build on a phone; unavailable during this change. TestFlight distribution is separate from backend deployment.

Run native tests from the repository root:

```sh
swiftc modules/fuel-up-driving-activity/ios/Research/DrivingResearchModels.swift modules/fuel-up-driving-activity/ios/Research/DrivingResearchConfirmation.swift modules/fuel-up-driving-activity/ios/Research/DrivingResearchStore.swift tests/swift/drivingResearch.swift -lsqlite3 -o /tmp/fuel-stop-tests
/tmp/fuel-stop-tests
node --test tests/drivingResearch.test.mjs tests/drivingResearchQuiet.test.cjs
```

## Uploads and operator sync requests

Automatic uploads start at 500 queued records on Wi-Fi and drain the entire queue, including the final remainder below 500. Cellular waits for Wi-Fi. A persistent drain intent resumes after an interruption without reapplying the threshold. Sync All and an operator request bypass Wi-Fi/Low Data Mode/threshold restrictions, but require a real connection. Upload requests carry up to 1,000 records and are also bounded by encoded bytes; every acknowledged batch retains the original event IDs. The single operation continues until no queued records remain. Offline manual requests persist for later connectivity. Pause cancels an active drain; deletion removes local and server data, count reports and remote requests after two confirmations.

The phone reports retained local record count and pending count once six hours have elapsed since its last successful report, using Wi-Fi or cellular. BackgroundTasks and existing native sensor/foreground/connectivity wakes provide execution opportunities. iOS decides when a suspended app runs; six hours is a reporting cadence, not an exact delivery guarantee. A disconnected phone cannot send counts or samples.

Operator tools (Supabase admin authentication required):

```sh
node scripts/driving-research/status.mjs
node scripts/driving-research/requestSync.mjs PARTICIPANT_UUID
```

A request is durable and scoped to exactly one enrolled participant. Duplicate requests reuse the outstanding command. The native app checks at most once per 15 minutes during ordinary wakes and also during scheduled background work. This is a queued request, not an APNs push or an immediate wake guarantee. It completes only after the local queue is drained; the server retains completion metadata. Participant credentials cannot queue requests for another person or see/complete another person's command. A paused collector does not accept remote commands until resumed; explicit manual sync remains available.

```sh
node scripts/driving-research/verifySync.mjs
```

This live test uses two temporary synthetic participants, verifies isolation and 1,201 immutable uploaded records (including retry of the first 1,000), then deletes the synthetic records, count reports and commands. The count reported to operators is a timestamped snapshot, not a live or lifetime counter. No personal routes belong in committed test evidence.

Validation for the Wi-Fi policy update: the focused Swift policy/store suite and 11 Node tests passed. The database migration and endpoint were deployed without applying unrelated pending migrations. A signed Release build was installed on the paired physical phone. Its count report arrived and an operator request was acknowledged as complete after a native relaunch. This verifies connected delivery and queue completion, not an instantaneous wake or exact six-hour background timing. Text outside filled blue buttons uses neutral theme colors; the Tracking and Saved Data sections are removed, and only missing permissions appear. Station logos reuse the bundled brand catalog, with a native pump icon for unknown brands.

## Isolated notification tests

Operator commands:

```sh
node scripts/driving-research/notificationTest.mjs send PARTICIPANT_UUID Mobil fuel
node scripts/driving-research/notificationTest.mjs send PARTICIPANT_UUID Mobil stop
node scripts/driving-research/notificationTest.mjs status PARTICIPANT_UUID TEST_UUID
node scripts/driving-research/notificationTest.mjs delete PARTICIPANT_UUID TEST_UUID
```

`send` uses a visible Apple push notification. It does not launch the app, invoke a device command, or wait for a control poll. The updated app must be opened once after installation to register its Apple device token with the authenticated participant. The signed provisioning entitlement selects sandbox or production; a Release configuration alone does not select production. APNs can present the alert while the app is not running, subject to the phone's notification settings and connectivity. This does not make station detection work after a user force-quits location tracking.

Operator credentials are read from `~/.config/fuelup/apns.json` (override with `FUELUP_APNS_CONFIG`), containing `keyId`, `teamId`, and `keyPath`. The downloaded Apple `.p8` signing key remains outside the repository and outside the app. APNs tokens are in a private participant table, never sensor samples. Research deletion removes the registered device address.

`send` prints the test UUID before claiming it atomically. Reusing that UUID reports the existing attempt and never sends again, including an unknown transport outcome. A 200 response means Apple accepted the alert, not that the user saw it. Transport failures remain unknown; explicit re-tests require a new UUID. The APNs-only fixture is never scheduled a second time by the phone's control polling. A native notification service extension attaches the bundled blue logo without an image download. The full fixture travels in the payload so a cold notification action can save its answer before any control fetch.

Notification titles, subtitle, hidden-preview text, sound, and answer actions match real stops. The blue Fuel Up logo is a native image attachment; iOS retains the app's standard small icon. No TEST prefix appears in notification copy. The Settings screen lists these fixtures separately under Test Notifications. A notification being scheduled is not proof that a banner was seen; an explicit answer is separately reported.

Tests use their own notification category/thread, atomic local JSON outbox, and private `driving_research_notification_tests` table. They never create station visits or `ResearchEvent` records and are excluded from sample counts. Answers save synchronously before the notification callback completes, then attempt a small immediate upload on either connection. Offline answers retry with the next successful control check. Dismissal remains unconfirmed and cannot overwrite an explicit answer. Tests expire after 24 hours; up to 20 may be retained per participant until the operator deletes them.

Deleting a test requires both its participant ID and test UUID. It hard-deletes only that test's server record. The next successful control response removes its local test entry, queued answer, and pending/delivered notification. Late responses cannot recreate deleted tests. Deleting all research data also removes every test for that participant. Real research data remains untouched by test-only deletion.

Validation: focused Swift test-store tests cover durable answers, matching copy, acknowledgement races, stale server snapshots, expiration and deletion. Twelve Node tests pass. `verifyNotificationTests.mjs` passed against the deployed endpoint with two temporary participants: targeted creation, duplicate-send identity, cross-participant denial, answer retries, late-response protection, test deletion preserving an unrelated research record, and complete synthetic fixture cleanup. Native build and presentation checks are recorded separately when completed.

Station Visits shows only stops with a successfully scheduled prompt (or an actual notification response). Created-only, permission-missing, and failed attempts are hidden. Newest stations appear first, with arrival and the preceding station's observed departure connected by continuous native SwiftUI lines and dots. Missing departures are not inferred from the last inside-station sample. Sync Data now sits beside Pause in the status card; accessibility text sizes stack the actions to avoid clipping.

### APNs implementation validation (2026-10-05)

- Nineteen focused Node/native permission and health tests passed. APNs tests verify the ES256 signature format, signed JWT fields, environment routing, alert headers and complete cold-answer payload.
- Swift fixture tests passed for offline answers, duplicate-push merging, expired fixtures, and tombstones preventing deleted tests from reappearing.
- The deployed synthetic integration passed private registration, APNs-only creation, duplicate claim prevention, cold answer acceptance, participant isolation, and deletion of device registrations with research data. No synthetic notifications were sent to Apple.
- The first live integration caught PostgreSQL's bounded-regex repetition limit. Token validation now checks length separately; the corrected schema and migration record match, and the full live integration passed afterward.
- Signed Release build and in-place installation on the intended iPhone 18 Pro Max succeeded. The packaged notification service extension includes the blue logo. The signed app has development APNs entitlement, so this install registers for sandbox.
- Actual closed-app alert presentation and the user's answer are separate verification steps; build/install and Apple's acceptance alone do not prove either.
