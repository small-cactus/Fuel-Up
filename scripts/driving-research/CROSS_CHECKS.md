# Driving research cross-checks

Added 2026-10-06. These are supporting observations, never fuel-purchase labels.

## What is collected

- `visit_pedometer`: historical Apple step count and estimated walking distance for an observed station stop, including unprompted stops. One summary follows a departure or an observation gap. Query only the observed interval, at most its final 20 minutes, and never before this collection session was enabled. Record the original and queried intervals, truncation, terminal event, returned data interval, and availability separately. A gap still means continuity is unknown.
- `system_visit`: Apple's approximate arrival/departure evidence within 150 meters of a cached station (including recent observed stops when the moving catalog has changed), with horizontal accuracy at most 100 meters. Keep up to five candidate stations and distances instead of forcing a match. Require known times to lie inside the enabled collection period and no later than receipt. Arrival-only and departure-only events are allowed; missing dates remain absent. This is not a record of every place visited.
- Location records now include available course accuracy. Existing speed accuracy, simulated/accessory source flags, sensor timestamps, motion flags, and confidence remain available.
- Lifecycle and cross-check records include Low Power Mode and Background App Refresh state. These describe collection conditions, not driver behavior; cross-check context is sampled when the result is saved and includes its own timestamp. Lifecycle records also identify step/distance availability and cross-check version.

## Collection and storage behavior

Uses public `CMPedometer` and `CLVisit` APIs with the existing Motion & Fitness and Always Location permissions. No HealthKit access, raw accelerometer stream, additional permission dialog, or Live Activity. The existing research consent text now names steps and walking distance explicitly. New measurements require research collection to be enabled and its existing permissions ready.

Departure/gap records in the durable SQLite outbox are the pedometer work queue. Unfinished work resumes after a process relaunch; completed visit IDs are not queried twice. Apple stores up to seven days of pedometer history. Expired history, unavailable hardware/authorization, query errors, and the 20-second query timeout are explicit unknown results with no step or distance measurement. A measured zero is preserved as zero. Late callbacks after pause or timeout cannot write results. Pause stops visit monitoring and invalidates callbacks; resume begins a new time boundary. Deletion erases the cross-check state along with the existing local/server research records. System visit duplicates are suppressed using the most recent 128 payload hashes.

Both event types use the existing immutable outbox and Wi-Fi/500-sample upload policy, including existing explicit manual/admin sync overrides. They do not issue provider lookups or upload on every motion change. Backend validation rejects malformed timestamps, out-of-scope coordinates/accuracy, invalid step counts, and measurements attached to unavailable results. New kinds use existing event storage; no database migration is required.

## Interpretation

An iOS visit is approximate and may arrive late. Absence of a visit or steps does not establish no stop or no walking. Walking may indicate a store visit, fueling, a passenger moving, or an unrelated nearby stop. The current small labeled sample is insufficient to calibrate those differences. Continue collecting explicit tester answers; unanswered events remain unconfirmed. Do not train on synthetic notification tests or smoke-test participants.

References: [CMPedometer](https://developer.apple.com/documentation/coremotion/cmpedometer), [historical query limits](https://developer.apple.com/documentation/coremotion/cmpedometer/querypedometerdata(from:to:withhandler:)), [CLVisit](https://developer.apple.com/documentation/corelocation/clvisit), [visit monitoring](https://developer.apple.com/documentation/corelocation/cllocationmanager/startmonitoringvisits()).

## Validation and rollout

- 22 focused tests passed across backend validation, native cross-check behavior, permissions, quiet-mode policy, tracking health, and APNs. Native cross-check tests exercise the actual Swift service with deterministic sensor callbacks, including relaunch deduplication, pause cancellation, timeout/late callbacks, unknown-versus-zero values, visit scope, partial dates, and deletion. They do not substitute for field measurements on a phone.
- Existing native detector/store tests passed, preserving the three-minute prompt gate and durable outbox behavior.
- The updated `driving-research` endpoint is deployed. `verifyCrossChecks.mjs` verified immutable read-back of synthetic available/unavailable pedometer results and a partial system visit, upload retry deduplication, and rejection of unavailable values masquerading as zero. All synthetic events were deleted and deletion was read back.
- Native Release simulator build passed; final incremental validation includes delayed-visit station lookup and updated Motion & Fitness purpose text. The new native collection code requires a future installed/TestFlight build; build 23 does not include it. No physical phone was opened or modified during this task.
