# TestFlight 1.0.0 (32): fewer false stop prompts

User authorized enabling the stronger location rule and distributing it through
TestFlight on October 20. Policy `station-stop-v3-core65` adds recent,
accuracy-expanded station distance to the existing three-minute eligibility.
It defers notifications until the median of accepted fixes in the preceding
minute is within 65 meters, with at least three distinct fixes spanning 30
seconds and a newest fix no older than 30 seconds.

The visit detector still records its existing observations, candidates,
departures, and gaps. Every accepted fix can reevaluate a deferred prompt;
departure never bypasses the stronger gate. Evidence resets for a new visit,
collection interruption, or process restart. A bounded in-memory buffer avoids
adding high-frequency persistent writes. Decision reason changes use existing
research diagnostics. Durable prompt claims and explicit participant labels
retain their existing meaning. An asynchronous notification attempt is also
cancelled if the visit has ended before scheduling finishes.

This is a precision tradeoff, not a promise of no false stops. The existing
38-visit exploratory comparison produced 2 false prompts instead of 7, with
14 fuel stops instead of 15 and all six previously reproduced non-fuel stops.
All avoided false prompts belonged to one participant; a different participant
lost one fuel prompt without gaining a false-prompt reduction. No new accuracy
claim is made from shipping the rule.

## Validation

The production Swift gate reproduced all 38 Python candidate decisions and
prompt times with zero mismatches (22 prompts). Private replay inputs remain
outside Git. Compiled synthetic tests cover deferral after the one-shot
candidate, duration, uncertainty, stale/future/invalid inputs, duplicate fixes,
moving fixes, departures, gaps, relaunch coverage, and durable notification
claims. Diagnostic metadata round-trips through the existing backend validator. All 41 related Node tests passed, along with the compiled native detector/store suite. No physical phone or road test was performed.

## Distribution

EAS reserved build 32, but its cloud build stopped before compilation because the notification-service extension had no signing credentials configured there. Signing setup through EAS was blocked by automatic approval review. The release instead used the existing local Xcode signing setup; no EAS credential change was needed.

The final local archive and App Store Connect export succeeded. Strict deep archive signature verification passed. The app and both extensions report 1.0.0 (32), and the compiled app contains `station-stop-v3-core65`. The first archive's notification-extension version mismatch was corrected before export or upload. Package metadata and SHA-256 are saved in `build-32/export-validation.json`.

Local archive: `/tmp/FuelUp-TestFlight-32.xcarchive`; exported package: `/tmp/FuelUp-TestFlight-32-export/FuelUp.ipa`. Build, export, and upload logs are under `/tmp/fuelup-core65-20261020/`. To make room, older Fuel Up archives below build 22 were losslessly compressed in their existing Archives folders; every archived regular file was SHA-256 checked against its compressed copy before replacing the uncompressed directory. Their apps, metadata, and crash symbols remain preserved, and active build caches were retained.

Apple accepted the upload on October 20, 2026 at 21:41:12 UTC. Safari shows build 32 processing. TestFlight group distribution remains pending processing. The exported app passed strict deep signature verification with production APNs and debugging disabled. The existing missing Hermes framework dSYM warning did not block upload. The public App Store submission remains unchanged.
