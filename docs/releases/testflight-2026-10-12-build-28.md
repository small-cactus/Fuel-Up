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

The expanded telemetry implementation is committed in `4b2b907`. The installation-telemetry endpoint and protected schema are deployed. The normal signed simulator UI test read back 101 real app-generated events with exact local payload matches and no pending outbox records; see `../research/2026-10-12-expanded-telemetry/simulator-ui-verification.json`. An initial device archive succeeded, but final packaging must include the later source changes. The final-source signed Release build succeeded and was installed in place on the paired iPhone 18 Pro Max. `codesign --verify --deep --strict` passed and `devicectl device info apps` reported Fuel Up 1.0.0 (28). Existing application data was preserved; the phone app was not launched for visual/sensor QA. Disk exhaustion had damaged one compiler module; the failed module was removed and the incremental build then passed. No build has been uploaded to TestFlight; Apple acceptance, processing, hosted privacy publication/data-disclosure review and group assignment remain unverified. App Store build 27's existing review submission is not being replaced or resubmitted.

Local build log: `/tmp/fuelup-testflight-28-archive.log`.
