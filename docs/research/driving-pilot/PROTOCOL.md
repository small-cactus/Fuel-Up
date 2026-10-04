# Native driving pilot v1

Purpose: collect consented, real driving and possible gas-station-visit observations for later recommendation research. No recommendation/ranking model is promoted by this change.

## Tester setup

Install the native build, open Settings → Research & Debug → Driving Research, choose Enable Collection, then read and accept the one-time consent sheet. Grant Always and Precise Location plus Motion & Fitness. If iOS defers the Always upgrade, use Open iPhone Settings, then return and finish setup. No notification, microphone, contacts, camera, or Bluetooth permission is requested by this flow. Each tester enrolls independently.

The collector resumes automatically after normal launches and location wakeups. Open once after installing; after a force quit, open again. iOS controls wake timing, privacy notices, permission changes, and battery management. The app creates neither a Live Activity nor a CLBackgroundActivitySession; CLLocationManager's optional background indicator is false. Exact indicator and real-drive behavior require physical-device verification. A successful build or simulator run is not that evidence.

## Native collection

Swift owns Core Location, Core Motion, the durable SQLite outbox, HTTPS upload, visit inference, and the SwiftUI debug screen. Expo only embeds that screen and unregisters legacy JS location/geofence tasks. The native app-delegate subscriber starts without a mounted React screen when consent and collection are already enabled.

Monitoring: standard location at 100 m requested accuracy / 150 m distance filter, plus significant-change wakeups. Driving: best requested accuracy / 15 m distance filter. Near a station during a recent drive, or during the first 20 minutes of a possible stop: best requested accuracy with no distance filter. Active modes disable automatic pauses; idle monitoring permits them. None of these settings guarantees a delivery interval.

Location records are sampled at most every 5 seconds during a drive/stop, or 30 seconds while monitoring. Sensor timestamp and receipt timestamp, coordinate, horizontal/speed accuracy, speed, course, simulated/accessory source flags, detector version, mode, and process session ID are retained. Motion stores all returned state flags, source time, and confidence. Out-of-order or duplicate location callbacks do not contribute to visit evidence. Low-quality samples remain identifiable and cannot establish a visit.

Station refresh: existing server-side inventory only, after moving 5 km from the last fetched center or after 30 minutes. Low Data Mode uses 10 km / 60 minutes. A 30-second attempt floor prevents retry storms; no request is made without a network path. The inventory, center, and fetch time survive relaunches. Up to 1,000 nearby stations (approximately a 33 km bounding box) are cached without price or preferred-brand filtering. Up to 18 nearest station geofences (250 m) plus an 800 m movement anchor remain within the 20-region budget. Geofences rotate locally with movement, without fetching inventory for each motion change or each geofence update. Offline cached inventory remains usable, but new-area coverage can be missing. No price-provider collection is initiated by this pilot.

## Labels and evidence

A geofence boundary is a wake-up observation, not proof of a visit. A possible station observation requires a fresh nonsimulated fix with accuracy at most 40 m, known speed below 2.5 m/s, and distance plus uncertainty within 110 m of the station coordinate. A candidate requires at least three valid samples spanning 120 seconds. Evidence gaps above 180 seconds end the sequence as a gap, never counted as dwell. Distance minus uncertainty above 180 m ends the observation. Nearby ambiguous station IDs are retained. Station coordinates represent a site, not surveyed pump polygons; false associations remain possible.

No automatic event claims fuel was purchased. After driving, a participant can label a visit: fueled, not fueling, wrong station, or unsure. These append separate events rather than rewriting sensor evidence. Conflicting repeated labels must be resolved during analysis using label timestamps. Evaluation should hold out drivers and future trips; do not train and evaluate on adjacent samples from the same trip as independent examples. Do not treat unlabeled stops as negative purchases.

## Storage and access

Per-device random credentials live in the Keychain (AfterFirstUnlockThisDeviceOnly). There are no names, contacts, advertising IDs, or APNs tokens in the enrollment. HTTPS requests use the participant secret; the server keeps only its SHA-256 hash. Private RLS-protected tables expose no client read/list access. Function requests have bounded batches, validation, and participant rate limits. Enrollment is capped at 100 active pilot participants.

SQLite uses WAL and full synchronization, excludes its folder from backups, and permits access after the first device unlock so locked-screen recording can continue. Uploads acknowledge exact immutable event IDs. Failed uploads remain queued, retry with bounded backoff, and do not overwrite prior events. Automatic uploads send at most 200 queued events per batch, no more often than every 5 minutes on Wi-Fi or 10 minutes on an expensive connection such as cellular. The last attempt is persisted across launches, so foreground transitions cannot bypass batching. Motion changes only create local records. Low Data Mode pauses automatic uploads; a manual Sync Saved Data can send one batch on any available connection. Pending batches wait for subsequent scheduled opportunities; iOS may delay those opportunities. Network path observation itself does not poll the server. The outbox stops collecting at 100,000 unsent records rather than silently discarding them. Successfully uploaded local records older than 30 days are pruned. Server research remains until deleted by the participant or research operator; there is no implicit seven-day price-campaign deadline for this separate opt-in pilot.

Pause stops sensors and pending uploads. Sync Saved Data can send already-consented queued data while paused. Delete stops recording, revokes the participant, deletes server events, then clears local records and credentials. Deletion is retryable after a lost response; local data remains if server deletion cannot be confirmed. Concurrent ingestion and deletion serialize on the participant row.

Export with `scripts/driving-research/export.mjs PARTICIPANT_UUID /private/tmp/output.jsonl` using operator database access. Outputs contain precise location history and must remain outside Git. Export is not an atomic snapshot while collection is active; pause or choose a fixed analysis cutoff for reproducible datasets. Only synthetic fixtures and aggregate verification results belong in committed QA evidence.

## Validation

See tests/swift/drivingResearch.swift for stop-evidence and durable-outbox execution; tests/drivingResearch.test.mjs and tests/sql/drivingResearch.sql for authentication, immutable retry, revocation, and deletion; tests/drivingResearchQuiet.test.cjs for suppressed alerts/activities and legacy-to-native ownership. Physical road testing must confirm cold/background wake, locked-screen collection, station approach coverage, stop labels, upload recovery, and battery cost. Do not claim those outcomes from simulated routes.
