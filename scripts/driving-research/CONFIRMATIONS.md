# Station stop confirmations

Native station-stop-v1 remains the detector: at least 120 seconds and three qualifying low-speed fixes near a known station. Accuracy must be at most 40 m; stale, simulated and duplicate fixes do not prove a stop. Gaps over 180 seconds interrupt dwell. This detects a possible stop, never a fuel purchase.

Each new two-minute candidate gets one local actionable notification titled “got fuel? 👀”. A shorter observed stop (at least 30 seconds and three qualifying samples) instead gets “got something at [station name]? 👀” after departure. The catalog station name supplies the brand/display name. Gaps and drive-bys do not trigger the shorter-stop question. Both use the exact subtitle “help Fuel Up get better. Tap and hold to answer”, with no extra body text. The wording is a question, not an inferred purchase label. Actions: Got fuel (`fueled`), Stopped, no fuel (`not_fueling`), Not a stop (`not_a_stop`). Tapping the notification opens Station Visits to answer or correct the station. Native actions save synchronously to SQLite before completing the iOS callback, including a cold background launch. No React bridge or network is required to save an answer.

`visit_prompt` records created, scheduled, permission_missing, schedule_failed, or dismissed, always with `confirmationState=unconfirmed`. Only explicit `visit_label` records provide participant labels. Unanswered or dismissed notifications are not negative examples. `unsure` also remains unconfirmed. The latest explicit label applies; immutable earlier records remain available. A local durable prompt claim prevents repeated prompts across restarts. A crash between claim and delivery may leave a created-only record, which remains unconfirmed rather than retrying an old stop.

Settings → Driving Research → Enable Stop Notifications requests native notification permission. Existing notification permission is reused. Denial does not stop recording. Pausing or deleting research cancels these prompts. No Live Activity, time-sensitive interruption, CarPlay notification option, push token, or per-answer network call is added. System Focus and notification settings still control delivery.

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
