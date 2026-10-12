# Installation app-usage silent sync

Every launch/foreground now attempts APNs registration independently of optional driving research and visible-notification authorization. This path does not request provisional or full alert authorization. It only flushes the existing allowlisted installation app-usage outbox; it does not enroll research or request new sensor permissions.

The server migration and installation-telemetry function were deployed October 12, 2026. A new native app release is required. TestFlight build 28 does not contain this registration path. Existing installations cannot be registered remotely without an app launch running the new code. No real-user installation push was sent during this change.

## Operation

`node scripts/installation-telemetry/requestSync.mjs INSTALLATION_UUID`

This operator-only command creates/reuses one durable outstanding request and sends at most one silent APNs hint. Usage and research silent pushes share a 30-minute device cooldown. No automatic resend occurs after a transport-unknown result. Device tokens are protected control records and never printed by the operator command.

- `push_status=accepted`: Apple accepted the push; not delivery proof.
- `received_at`: the installation retrieved the command using its credential. Foreground retrieval can also set this, so it is not proof of a background wake.
- `completed_at`: client reported its pending usage outbox drained after server acknowledgments. An empty queue can complete without any new data.
- New `app_installation_events` rows: actual received usage records. Inspect separately from completion.

Foreground command retrieval provides a fallback for delayed/dropped pushes. Background execution has a 25-second callback deadline; durable file uploads may finish later. Failed/expired work does not acknowledge command completion or discard pending records. iOS may defer/suppress background notifications; force-quit and system background restrictions can prevent a wake. APNs registration is an attempt, not a guarantee every installation is reachable.

## Validation

- Nine targeted tests passed across installation API policy, silent payload construction, the real native handler, actual outbox-drain logic, and existing research push handling.
- Rollback-only database verification passed before and after migration: credential and command isolation, no-device behavior, completion preconditions, idempotency, token rotation, shared cooldown in both directions, research revocation, RPC/table access controls.
- Deployed endpoint verification passed: a synthetic installation registered without research, rejected wrong credentials, retrieved an authenticated command, uploaded a usage event, and completed. Synthetic installation/events/address/command were removed and cleanup verified. No APNs call was made.
- Existing deployed installation ingestion regression passed: immutable retry/dedup, permissions, onboarding completion and credential isolation; synthetic fixture removed.

Repeatable checks:

```sh
node --test tests/installationSync.test.mjs tests/installationTelemetry.test.mjs tests/installationSilentPush.test.cjs tests/installationSyncDrain.test.cjs tests/drivingResearchSilentPush.test.cjs
node scripts/installation-telemetry/verifySync.mjs
node scripts/installation-telemetry/verifySyncEndpoint.mjs
node scripts/installation-telemetry/verify.mjs
```

Apple references:
- https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns
- https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications
- https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app

## Build environment

The first signed Release build ran out of disk space (116 MB available). Removed only the completed archive build's regenerable `ArchiveIntermediates` under the default FuelUp DerivedData directory, recovering about 3 GB. Preserved the final uploaded build-28 archive/export, source, QA evidence, and active `/tmp/FuelUpGlassDevice` device and default simulator caches. Retried incrementally using `npm run ios:device -- 00008160-001E206E02A0000A` without installation.

The retry succeeded in 261 seconds. The build script's deep strict signature verification and bundle-ID check passed. Both new Swift files compiled in the FuelUpDrivingActivity target. Local logs: `/tmp/fuelup-installation-sync-build.log` (disk failure) and `/tmp/fuelup-installation-sync-build-retry.log` (success). This app was **not installed, launched, or uploaded to TestFlight** as part of this change; real-device APNs receipt for the new installation-specific handler remains unverified.
