# TestFlight build 1.0.0 (28): fuel notification timing research

User requested station-independent notification timing research, assuming instant on-device access, and a TestFlight collection update if departure history was missing. The frozen replay is in `docs/research/2026-10-12-refuel-timing/README.md`.

## Changes

- Recover historical Apple motion transitions across process suspension, limited to the enabled collection boundary and at most seven days. Query every 15 minutes at most on ordinary wakes, with three-minute settling delay and explicit incomplete/error evidence.
- Append receipt-time timezone, UTC offset and application state to research records.
- Preserve enabled enrollment, permission requirements, durable outbox and existing upload behavior. Pause clears the recovery boundary; no collection across paused periods or before the update's first collection boundary.
- Keep predictive notifications disabled. The update collects evidence for learning timing and does not change station recommendations.

## Validation completed

- EAS remote build number reserved and read back as 28.
- 18 focused native collection, permission, quiet-mode and backend tests passed. Native history tests exercise the actual Swift implementation with deterministic sensor callbacks.
- Six timing-replay tests and seven earlier causal-replay tests passed.
- Existing deployed research endpoint accepted synthetic timing/history records; immutable read-back and upload deduplication passed. The temporary synthetic participant records were deleted and deletion was verified. No server schema or function deployment was required.
- Raw participant routes remain private; only aggregate research results are committed.

## Distribution status

Release work paused at the user's request to reconsider background packet design. The running archive was interrupted before completion; no build was uploaded. Package/signature checks, Apple upload acceptance, processing and TestFlight group assignment are not yet verified. App Store build 27's existing review submission is not being replaced or resubmitted.

Local build log: `/tmp/fuelup-testflight-28-archive.log`.
