# TestFlight build 1.0.0 (28): fuel notification timing research

User requested station-independent notification timing research, assuming instant on-device access, and a TestFlight collection update if departure history was missing. The frozen replay is in `docs/research/2026-10-12-refuel-timing/README.md`.

## Changes

- Recover historical Apple motion transitions across process suspension, limited to the enabled collection boundary and at most seven days. Query every 15 minutes at most on ordinary wakes, with three-minute settling delay and explicit incomplete/error evidence.
- Append receipt-time timezone, UTC offset and application state to research records.
- Preserve enabled enrollment, permission requirements and durable outbox; update research automatic upload to coalesced cellular/Wi-Fi transfer. Pause clears the recovery boundary; no collection across paused periods or before the update's first collection boundary.
- Keep predictive notifications disabled. The update collects evidence for learning timing and does not change station recommendations.

Additional collection includes per-installation onboarding, permissions, screen dwell, map/card activity and device profiles, plus consented general visits, step history and receipt context. Full scope: `docs/research/2026-10-12-expanded-telemetry/README.md`.

## Validation completed

- EAS remote build number reserved and read back as 28.
- 18 focused native collection, permission, quiet-mode and backend tests passed. Native history tests exercise the actual Swift implementation with deterministic sensor callbacks.
- Six timing-replay tests and seven earlier causal-replay tests passed.
- Existing deployed research endpoint accepted synthetic timing/history records; immutable read-back and upload deduplication passed. The temporary synthetic participant records were deleted and deletion was verified. No server schema or function deployment was required.
- Raw participant routes remain private; only aggregate research results are committed.

## Distribution status

The expanded telemetry implementation is committed in `4b2b907`. The installation-telemetry endpoint and protected schema are deployed. The normal signed simulator UI test read back 101 real app-generated events with exact local payload matches and no pending outbox records; see `../research/2026-10-12-expanded-telemetry/simulator-ui-verification.json`. An initial device archive succeeded, but final packaging must include the later source changes. The final-source signed Release build succeeded and was installed in place on the paired iPhone 18 Pro Max. `codesign --verify --deep --strict` passed and `devicectl device info apps` reported Fuel Up 1.0.0 (28). Existing application data was preserved; the phone app was not launched for visual/sensor QA. Disk exhaustion had damaged one compiler module; the failed module was removed and the incremental build then passed. The final-source archive and upload status are recorded below. App Store build 27's existing review submission is not being replaced or resubmitted.

Local build log: `/tmp/fuelup-testflight-28-archive.log`.

## Final archive and upload (October 12)

- Source includes `23f601e`: existing research participants check notification authorization on ordinary foreground activation, request full alert/sound permission for not-determined or provisional status, and skip authorized/denied statuses. This does not resume paused research. Five focused permission/quiet tests passed.
- Final archive: `/tmp/FuelUp-TestFlight-28-final.xcarchive`; deep strict code-signature verification passed. App version 1.0.0, build 28.
- App Store export succeeded, using Cloud Managed Apple Distribution signing. Exported IPA SHA-256: `5afd0eaa35f4b88208c46d1260d4669d7f5804b2b156f61f8f732a14329f430c`.
- Upload succeeded at 2026-10-12 13:56:28 UTC. App Store Connect showed build 28 Processing. Upload emitted a non-blocking missing Hermes framework dSYM warning; Hermes crash symbolication may be incomplete. Upload acceptance is not tester availability.
- Published the October 12 privacy policy to https://sites.google.com/view/fuel-up-gas/home and verified public read-back of installation profiles, product interactions, motion history and updated cellular/Wi-Fi uploads.
- Reviewed App Store privacy categories: linked precise/coarse location, fitness, user/device IDs, purchases, product interaction and other diagnostics are disclosed. Added Analytics to Device ID purposes while preserving linked identity and no advertising tracking; verified saved publication.
- Existing App Store build 27 remains Waiting for Review and was not replaced or resubmitted.

Logs: `/tmp/fuelup-testflight-28-final-archive.log`, `/tmp/fuelup-testflight-28-final-export.log`, `/tmp/fuelup-testflight-28-final-upload.log`.
