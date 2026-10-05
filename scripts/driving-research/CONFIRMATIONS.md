# Station stop confirmations

Native station-stop-v1 remains the detector: at least 120 seconds and three qualifying low-speed fixes near a known station. Accuracy must be at most 40 m; stale, simulated and duplicate fixes do not prove a stop. Gaps over 180 seconds interrupt dwell. This detects a possible stop, never a fuel purchase.

Each new candidate gets one local actionable notification: “⛽ Quick stop check”, station name, “Did you get fuel? Hold to answer.” Actions: Got fuel (`fueled`), Stopped, no fuel (`not_fueling`), Not a stop (`not_a_stop`). Tapping the notification opens Station Visits to answer or correct the station. Native actions save synchronously to SQLite before completing the iOS callback, including a cold background launch. No React bridge or network is required to save an answer.

`visit_prompt` records created, scheduled, permission_missing, schedule_failed, or dismissed, always with `confirmationState=unconfirmed`. Only explicit `visit_label` records provide participant labels. Unanswered or dismissed notifications are not negative examples. `unsure` also remains unconfirmed. The latest explicit label applies; immutable earlier records remain available. A local durable prompt claim prevents repeated prompts across restarts. A crash between claim and delivery may leave a created-only record, which remains unconfirmed rather than retrying an old stop.

Settings → Driving Research → Enable Stop Notifications requests native notification permission. Existing notification permission is reused. Denial does not stop recording. Pausing or deleting research cancels these prompts. No Live Activity, time-sensitive interruption, CarPlay notification option, push token, or per-answer network call is added. System Focus and notification settings still control delivery.

Validation: Swift detector/outbox tests include drive-bys, gaps, ambiguity, dismissed vs explicit labels, and reopening storage. Node tests cover endpoint validation, authorization, acknowledgements, and disabled Live Activities. The deployed endpoint accepted synthetic prompt/answer records; the temporary participant was deleted. The signed generic iPhone Release build passed. Physical notification presentation and background action handling still require the new build on a phone; unavailable during this change. TestFlight distribution is separate from backend deployment.

Run native tests from the repository root:

```sh
swiftc modules/fuel-up-driving-activity/ios/Research/DrivingResearchModels.swift modules/fuel-up-driving-activity/ios/Research/DrivingResearchConfirmation.swift modules/fuel-up-driving-activity/ios/Research/DrivingResearchStore.swift tests/swift/drivingResearch.swift -lsqlite3 -o /tmp/fuel-stop-tests
/tmp/fuel-stop-tests
node --test tests/drivingResearch.test.mjs tests/drivingResearchQuiet.test.cjs
```
