# Expanded research and installation telemetry

Status: implementation and live backend smoke verification complete; normal Release simulator interaction/upload verification and TestFlight distribution still pending.

## Installation dossier

The updated iOS app creates a random credentialed installation identity on first opening. This is an installation, not a verified person, and cannot reconstruct earlier onboarding. No account or driving-research enrollment is required for first-party usage events.

`app_installations` stores the device profile, first/last receipt, maximum onboarding step, completion flag and deduplicated event count. `app_installation_events` stores the immutable ordered timeline, including original event time and server receipt time. Tables have RLS and no anon/authenticated access. The service-only RPC authenticates the hashed per-installation credential and atomically ingests each bounded batch. Existing event IDs cannot be overwritten. Backend validates field allowlists, lengths, types, timestamps and batch sizes; installation rate limit is 600 received events/minute.

Collected usage events:
- Process launches, foreground/background transitions and sessions.
- Route/screen entry, exit and observed foreground duration. A 30-second heartbeat caps unobserved tail loss if the process dies. Durations are cumulative per `screenSegmentId`; never sum heartbeat and exit durations.
- Native onboarding step transitions, Continue/Skip/Save intent, preferences counts, permission requests/results, completion only after preferences persist and Home preparation succeeds, and save/handoff failure.
- Location, precise location, motion, notifications and background refresh states. A permission snapshot is an observation; a request event does not mean permission was granted. Native onboarding captures the current step.
- Map pan/pinch/rotate/double-tap begin/end/cancel, deliberate station selections and Show All, station-card Go with selected station ID, fuel grade and rank, Settings actions.
- Device hardware model, OS/app/build, display size in points/pixels, scaling, content-size category, locale, time zone and simulator flag.

Consented research packets carry the installation ID for joining that participant’s research and usage timelines. No raw GPS coordinates, viewport coordinates, audio, other-app activity, text entry, contacts, advertising IDs, or full provider objects enter installation analytics. Precise location and richer context remain in the consented research collection.

Each event is written to a separate SQLite outbox before transfer. A native background URLSession batches up to 50 events, coalesces for two seconds, permits cellular/Wi-Fi and continues transfers under iOS scheduling. It acknowledges only the exact durable server IDs. Failures retain events with exponential retry. Unsent queue capacity is 100,000; successful local records age out after 30 days. Force quitting/offline/OS scheduling can delay transfers. Installation profiles persist remotely until explicitly deleted; this is separate from the research-data deletion control.

Protected export, one private JSON file per installation:

```sh
node scripts/installation-telemetry/export.mjs --out /absolute/private/directory
```

Exports omit credentials/token hashes and reject output inside the repo. Each file contains profile metadata and the time-ordered event timeline. Use `profile.isSimulator` to exclude QA installations from user analyses.

## Research additions

Existing enrollment/permissions gate all sensor collection. New diagnostic sources use the current research ingest contract:
- `fuelup_interaction`: app foreground/background, deliberate map/card activity and selected station snapshot.
- `apple_general_visit`: Apple arrival/departure estimates at any visited place, with unknown endpoints and receipt times explicit. Arrival/departure is not a fuel purchase.
- `apple_step_history`: five-minute pedometer bins, original query/data windows, steps, available distance/floors/average active pace. At most 12 sequential queries per ordinary wake, 15-minute query-attempt interval and seven-day recovery horizon. Failed queries do not advance the cursor.
- `apple_motion_history`: previously added historical movement transitions with chunk completeness and original timestamps.

Every research record adds receipt-time app-interaction recency, battery/charging availability, thermal/low-power/background-refresh state, the app's observable audio output port types (no audio session activation), permissions, network availability/expense/constraint and last-fix age. Location samples add available altitude/vertical accuracy. Missing data stays unknown, not zero. Receipt context must not be backdated to delayed sensor observations.

The new histories begin at updated-app collection start; pause/permission shutdown resets boundaries and invalidates late callbacks. General visits are deduplicated and can carry partial arrival/departure. Current audio route is only what this app can observe and does not establish driver/vehicle identity.

Research auto-sync now coalesces briefly and uses cellular/Wi-Fi instead of waiting for 500 events on Wi-Fi. Old clients retain their old policy. No prediction notifications, station-preference model, or new provider collection was enabled.

## Validation so far

- 44 focused tests passed, including native permission sequencing, motion/step history pause/cursor/error cases, backend input/authentication, card payloads, collector behavior and localization.
- Live synthetic installation fixture: exact read-back, wrong-credential rejection, retry deduplication, immutable event payload, permission state, onboarding progress/completion and cascade cleanup all passed. No tester records were modified.
- First Release device archive succeeded. Final archive must be rebuilt after final changes.
- Broad existing suite: 165/165 passed on rerun. Initial run had a transient `fuelCacheReset` failure; its isolated seven-test suite and the full rerun both passed without code changes.
- Normal signed Release simulator UI verification passed: 101 server events matched the local durable payloads exactly, with zero pending uploads. Completed onboarding (including location denial then Settings grant), selected Premium, skipped preferences, panned/pinched the map, selected a different station and tapped Go. Station selection and Go both uploaded ID `186777`; Apple Maps opened. Trends dwell was 14.771 seconds and Settings dwell 10.498 seconds. Three launches retained one installation identity. Median receipt delay was 2.469 seconds; maximum 52.539 seconds, so two-second coalescing is not a delivery guarantee. See `simulator-ui-verification.json`.
- QA used ordinary UI gestures and normal `simctl launch` without test arguments or fabricated app events. Standard simulated location was Clearwater. The first unsigned simulator build failed Keychain access; normal signing fixed the test environment. Disk exhaustion during setup was resolved using disposable/obsolete outputs and package download cache. No telemetry implementation change was needed for the successful run.
- The simulator reports motion unavailable and correctly pauses the research sensor collector. Real driving/pedometer/visit collection and a real cellular connection still require physical-device verification.

Privacy-policy source was expanded for these fields and the new upload policy. Publishing the corresponding hosted page and confirming App Store data disclosures remain release checks.
